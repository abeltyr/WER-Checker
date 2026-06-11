import { generateText } from "ai"
import { z } from "zod"
import type { LoadedPrompts } from "./prompts"
import type { Sample, AiResult, GeminiOutput } from "../core/types"
import { estimateCostUsd } from "./models"

const GeminiOutputSchema = z.object({
  transcription: z.string(),
  gender: z.string(),
  dialect: z.string(),
  speaker_count: z.number(),
})

const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 10000
// A hung HTTP request would otherwise block a concurrency slot forever and
// the whole pipeline looks "stuck" — every call gets a hard deadline.
const REQUEST_TIMEOUT_MS = 120_000
// Extra slack for the Promise.race fallback that fires even when the abort
// signal fails to propagate into a hung socket.
const HARD_DEADLINE_GRACE_MS = 5_000
// While a request is in flight, say so — slow generation must be
// distinguishable from a dead pipeline.
const HEARTBEAT_INTERVAL_MS = 20_000

export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** Hard deadline per API request; timed-out requests are retried */
  timeoutMs?: number
}

function isRetryableError(err: unknown): boolean {
  const msg =
    err instanceof Error ? err.message.toLowerCase()
    : typeof err === "string" ? err.toLowerCase()
    : ""
  if (!msg) return false
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("resource exhausted") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("aborted") ||
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    msg.includes("503") ||
    msg.includes("overloaded") ||
    msg.includes("high demand") ||
    msg.includes("try again later") ||
    msg.includes("unavailable") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("socket hang up")
  )
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Pull the audio share of the prompt tokens out of the provider metadata.
 * Gemini reports per-modality counts in usageMetadata.promptTokensDetails;
 * anything else (or a shape change) just returns undefined and the cost
 * estimate bills all input at the audio rate.
 */
function extractAudioInputTokens(providerMetadata: unknown): number | undefined {
  try {
    const google = (providerMetadata as Record<string, any> | undefined)?.google
    const details = google?.usageMetadata?.promptTokensDetails
    if (!Array.isArray(details)) return undefined
    const audio = details.find((d: any) => String(d?.modality).toUpperCase() === "AUDIO")
    return typeof audio?.tokenCount === "number" ? audio.tokenCount : undefined
  } catch {
    return undefined
  }
}

/** Gemini sometimes wraps JSON output in ```json fences despite instructions. */
function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return match ? match[1]! : trimmed
}

function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const delay = baseDelayMs * Math.pow(2, attempt)
  return Math.min(delay, maxDelayMs)
}

export async function invokeModelWithRetry(
  model: ReturnType<typeof import("./client").createModel>,
  sample: Sample,
  prompts: LoadedPrompts,
  retryOptions?: RetryOptions,
): Promise<AiResult> {
  const maxRetries = retryOptions?.maxRetries ?? MAX_RETRIES
  const baseDelayMs = retryOptions?.baseDelayMs ?? BASE_DELAY_MS
  const maxDelayMs = retryOptions?.maxDelayMs ?? MAX_DELAY_MS
  const timeoutMs = retryOptions?.timeoutMs ?? REQUEST_TIMEOUT_MS

  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await invokeModel(model, sample, prompts, timeoutMs)

    if (result.success) {
      return result
    }

    if (!isRetryableError(result.error)) {
      return result
    }

    lastError = new Error(result.error)

    if (attempt < maxRetries - 1) {
      const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs)
      console.log(`  Retry ${attempt + 1}/${maxRetries} in ${delay}ms...`)
      await sleep(delay)
    }
  }

  return {
    sampleId: sample.id,
    success: false,
    error: lastError?.message ?? "Max retries exceeded",
    latencyMs: 0,
    tokenUsage: { input: 0, output: 0, total: 0 },
    modelVersion: "unknown",
    rawResponse: null,
  }
}

async function invokeModel(
  model: ReturnType<typeof import("./client").createModel>,
  sample: Sample,
  prompts: LoadedPrompts,
  timeoutMs: number,
): Promise<AiResult> {
  const start = performance.now()

  const heartbeat = setInterval(() => {
    const elapsed = Math.round((performance.now() - start) / 1000)
    console.log(`  [${sample.id}] waiting on API… ${elapsed}s elapsed (timeout ${Math.round(timeoutMs / 1000)}s)`)
  }, HEARTBEAT_INTERVAL_MS)
  let hardDeadline: ReturnType<typeof setTimeout> | undefined

  try {
    const { text, usage, response, providerMetadata } = await Promise.race([
      generateText({
        model: model.model,
        providerOptions: model.providerOptions as never,
        ...model.callSettings,
        // Retries are handled by invokeModelWithRetry — the SDK's internal
        // retry layer would multiply attempts (3 × 3 = 9 requests per sample).
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(timeoutMs),
        system: prompts.system,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompts.user },
              // Pass the buffer directly — the SDK encodes it without us
              // materialising a base64 data URI (~2.3× the audio in memory).
              { type: "file", data: sample.audioBuffer, mediaType: sample.audioMimeType },
            ],
          },
        ],
      }),
      // Belt and braces: even if the abort signal never propagates into a
      // hung socket, the concurrency slot is freed at this deadline.
      new Promise<never>((_, reject) => {
        hardDeadline = setTimeout(
          () => reject(new Error(`request timed out after ${timeoutMs + HARD_DEADLINE_GRACE_MS}ms (hard deadline)`)),
          timeoutMs + HARD_DEADLINE_GRACE_MS,
        )
      }),
    ])

    const elapsed = performance.now() - start

    const jsonText = stripCodeFences(text)
    let parsed: GeminiOutput | undefined
    try {
      const validated = GeminiOutputSchema.parse(JSON.parse(jsonText))
      parsed = validated as GeminiOutput
    } catch {
      try {
        parsed = JSON.parse(jsonText) as GeminiOutput
      } catch {
        parsed = undefined
      }
    }

    const inputTokens = usage?.inputTokens ?? 0
    const outputTokens = usage?.outputTokens ?? 0
    const audioInput = extractAudioInputTokens(providerMetadata)

    return {
      sampleId: sample.id,
      success: true,
      latencyMs: Math.round(elapsed),
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        total: usage?.totalTokens ?? inputTokens + outputTokens,
        ...(audioInput !== undefined ? { audioInput } : {}),
      },
      costUsd: estimateCostUsd(model.modelId, {
        inputTokens,
        outputTokens,
        audioInputTokens: audioInput,
      }),
      modelVersion: response?.modelId ?? "unknown",
      rawResponse: text,
      parsedResponse: parsed,
    }
  } catch (err) {
    const elapsed = performance.now() - start

    return {
      sampleId: sample.id,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Math.round(elapsed),
      tokenUsage: { input: 0, output: 0, total: 0 },
      modelVersion: "unknown",
      rawResponse: null,
    }
  } finally {
    clearInterval(heartbeat)
    if (hardDeadline) clearTimeout(hardDeadline)
  }
}
