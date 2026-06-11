import { describe, it, expect } from "bun:test"
import { MockLanguageModelV3 } from "ai/test"
import { invokeModelWithRetry } from "../../../src/ai/invoke"
import type { ConfiguredModel } from "../../../src/ai/client"
import { makeSample, makeGeminiOutput } from "../../helpers"

const prompts = { system: "system prompt", user: "user prompt" }
const FAST_RETRY = { baseDelayMs: 1, maxDelayMs: 2 }

function mockModel(doGenerate: any): ConfiguredModel {
  return { model: new MockLanguageModelV3({ doGenerate }) as any, modelId: "test-model" }
}

function textResponse(text: string) {
  return async () => ({
    finishReason: "stop" as const,
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 5, text: 5, reasoning: undefined },
    },
    content: [{ type: "text" as const, text }],
    warnings: [],
  })
}

describe("invokeModelWithRetry — success paths", () => {
  it("parses a valid JSON response and maps token usage", async () => {
    const output = makeGeminiOutput("ሰላም አለም")
    const model = mockModel(textResponse(JSON.stringify(output)))

    const result = await invokeModelWithRetry(model as any, makeSample(), prompts)

    expect(result.success).toBe(true)
    expect(result.parsedResponse).toBeDefined()
    expect(result.parsedResponse!.transcription).toBe("ሰላም አለም")
    expect(result.tokenUsage.input).toBe(10)
    expect(result.tokenUsage.output).toBe(5)
    expect(result.tokenUsage.total).toBe(15)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it("strips markdown code fences before parsing", async () => {
    const output = makeGeminiOutput("ሰላም")
    const fenced = "```json\n" + JSON.stringify(output) + "\n```"
    const model = mockModel(textResponse(fenced))

    const result = await invokeModelWithRetry(model as any, makeSample(), prompts)

    expect(result.success).toBe(true)
    expect(result.parsedResponse).toBeDefined()
    expect(result.parsedResponse!.transcription).toBe("ሰላም")
  })

  it("forwards custom call settings to the model request", async () => {
    let received: any
    const output = makeGeminiOutput("ሰላም")
    const respond = textResponse(JSON.stringify(output))
    const model = mockModel(async (options: any) => {
      received = options
      return respond()
    })
    model.callSettings = { temperature: 0, maxOutputTokens: 2048 }

    const result = await invokeModelWithRetry(model as any, makeSample(), prompts)

    expect(result.success).toBe(true)
    expect(received.temperature).toBe(0)
    expect(received.maxOutputTokens).toBe(2048)
  })

  it("keeps success=true with undefined parsedResponse for non-JSON output", async () => {
    const model = mockModel(textResponse("I cannot transcribe this audio."))

    const result = await invokeModelWithRetry(model as any, makeSample(), prompts)

    expect(result.success).toBe(true)
    expect(result.parsedResponse).toBeUndefined()
    expect(result.rawResponse).toBe("I cannot transcribe this audio.")
  })
})

describe("invokeModelWithRetry — failure and retry paths", () => {
  it("fails immediately on non-retryable errors", async () => {
    let calls = 0
    const model = mockModel(async () => {
      calls++
      throw new Error("API key not valid. Please pass a valid API key.")
    })

    const result = await invokeModelWithRetry(model as any, makeSample(), prompts, FAST_RETRY)

    expect(result.success).toBe(false)
    expect(result.error).toContain("API key not valid")
    expect(calls).toBe(1)
  })

  it("retries retryable errors up to the limit", async () => {
    let calls = 0
    const model = mockModel(async () => {
      calls++
      throw new Error("429 Too Many Requests: rate limit exceeded")
    })

    const result = await invokeModelWithRetry(model as any, makeSample(), prompts, {
      ...FAST_RETRY,
      maxRetries: 3,
    })

    expect(result.success).toBe(false)
    expect(calls).toBe(3)
  })

  it("aborts a hung request at the timeout and treats it as retryable", async () => {
    let calls = 0
    // Never resolves on its own — only the abort signal can end it,
    // exactly like a hung HTTP request.
    const model = mockModel(async ({ abortSignal }: any) => {
      calls++
      return new Promise((_, reject) => {
        abortSignal?.addEventListener("abort", () => reject(abortSignal.reason))
      })
    })

    const result = await invokeModelWithRetry(model as any, makeSample(), prompts, {
      ...FAST_RETRY,
      maxRetries: 2,
      timeoutMs: 20,
    })

    expect(result.success).toBe(false)
    expect(calls).toBe(2) // timed out, retried, timed out again
    expect(result.error!.toLowerCase()).toMatch(/timed out|timeout|abort/)
  })

  it("recovers when a retry succeeds", async () => {
    let calls = 0
    const output = makeGeminiOutput("ሰላም")
    const respond = textResponse(JSON.stringify(output))
    const model = mockModel(async (options: any) => {
      calls++
      if (calls === 1) throw new Error("503 Service Unavailable: model overloaded")
      return respond()
    })

    const result = await invokeModelWithRetry(model as any, makeSample(), prompts, FAST_RETRY)

    expect(result.success).toBe(true)
    expect(calls).toBe(2)
    expect(result.parsedResponse).toBeDefined()
  })
})
