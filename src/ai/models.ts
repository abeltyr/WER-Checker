import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { z } from "zod"
import type { ModelOptions } from "../core/types"

export type Provider = "google" | "openai"

export const PROVIDERS: Provider[] = ["google", "openai"]

export interface ModelPricing {
  /** USD per 1M text input tokens */
  inputPer1M: number
  /** USD per 1M audio input tokens — what transcription input is billed at */
  audioInputPer1M: number
  /** USD per 1M output tokens */
  outputPer1M: number
}

export interface ModelInfo {
  id: string
  provider: Provider
  description: string
  pricing: ModelPricing
  /** Provenance of the prices — update when the vendors change pricing */
  pricingNote?: string
  /** Generation settings attached to this model in the provider config */
  options?: ModelOptions
  /** True when the model comes from a config file rather than the built-ins */
  custom?: boolean
}

/**
 * Built-in fallback registry — used when no config/providers/<provider>.json
 * exists. The config files extend and override this list per model id.
 * Prices are USD per 1M tokens, last reviewed 2026-06.
 */
export const KNOWN_MODELS: ModelInfo[] = [
  {
    id: "gemini-3-flash-preview",
    provider: "google",
    description: "Gemini 3 Flash (preview) — current default",
    pricing: { inputPer1M: 0.3, audioInputPer1M: 1.0, outputPer1M: 2.5 },
    pricingNote: "estimate (preview pricing not final) — verify before relying on cost numbers",
  },
  {
    id: "gemini-3-pro-preview",
    provider: "google",
    description: "Gemini 3 Pro (preview) — strongest Gemini",
    pricing: { inputPer1M: 2.0, audioInputPer1M: 2.0, outputPer1M: 12.0 },
    pricingNote: "≤200k context tier; estimate — verify before relying on cost numbers",
  },
  {
    id: "gemini-2.5-pro",
    provider: "google",
    description: "Gemini 2.5 Pro — strong on hard audio",
    pricing: { inputPer1M: 1.25, audioInputPer1M: 1.25, outputPer1M: 10.0 },
  },
  {
    id: "gemini-2.5-flash",
    provider: "google",
    description: "Gemini 2.5 Flash — good quality/cost balance",
    pricing: { inputPer1M: 0.3, audioInputPer1M: 1.0, outputPer1M: 2.5 },
  },
  {
    id: "gemini-2.5-flash-lite",
    provider: "google",
    description: "Gemini 2.5 Flash-Lite — cheapest Gemini with audio",
    pricing: { inputPer1M: 0.1, audioInputPer1M: 0.3, outputPer1M: 0.4 },
  },
  {
    id: "gemini-2.0-flash",
    provider: "google",
    description: "Gemini 2.0 Flash — fast, cheap baseline",
    pricing: { inputPer1M: 0.1, audioInputPer1M: 0.7, outputPer1M: 0.4 },
  },
  {
    id: "gpt-4o-audio-preview",
    provider: "openai",
    description: "GPT-4o audio — strong multilingual transcription",
    pricing: { inputPer1M: 2.5, audioInputPer1M: 40.0, outputPer1M: 10.0 },
  },
  {
    id: "gpt-4o-mini-audio-preview",
    provider: "openai",
    description: "GPT-4o mini audio — cheaper OpenAI cross-check",
    pricing: { inputPer1M: 0.15, audioInputPer1M: 10.0, outputPer1M: 0.6 },
  },
]

// ─── provider config files ────────────────────────────────────────────────────

export const DEFAULT_PROVIDER_CONFIG_DIR = "config/providers"

const pricingSchema = z.object({
  inputPer1M: z.number().positive(),
  audioInputPer1M: z.number().positive(),
  outputPer1M: z.number().positive(),
})

const optionsSchema = z.object({
  thinkingBudget: z.number().int().min(0).optional(),
  temperature: z.number().min(0).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  providerOptions: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
})

const providerFileSchema = z.object({
  defaultModel: z.string().optional(),
  /** Provider-wide generation settings — overridden per model */
  options: optionsSchema.optional(),
  models: z
    .record(
      z.string(),
      z.object({
        description: z.string().optional(),
        pricing: pricingSchema.optional(),
        pricingNote: z.string().optional(),
        options: optionsSchema.optional(),
      }),
    )
    .optional(),
})

export type ProviderFile = z.infer<typeof providerFileSchema>

const fileCache = new Map<string, ProviderFile>()

/** Load config/providers/<provider>.json — absent file means "use built-ins". */
export function loadProviderFile(provider: Provider, baseDir = DEFAULT_PROVIDER_CONFIG_DIR): ProviderFile {
  const path = resolve(join(baseDir, `${provider}.json`))
  const cached = fileCache.get(path)
  if (cached) return cached

  let raw: string
  try {
    raw = readFileSync(path, "utf-8")
  } catch {
    const empty: ProviderFile = {}
    fileCache.set(path, empty)
    return empty
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Invalid JSON in provider config ${path}: ${err instanceof Error ? err.message : err}`)
  }
  const result = providerFileSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new Error(`Invalid provider config ${path}: ${issues}`)
  }

  fileCache.set(path, result.data)
  return result.data
}

/** Built-ins extended/overridden by the provider config files. */
export function getAllModels(baseDir = DEFAULT_PROVIDER_CONFIG_DIR): ModelInfo[] {
  const merged: ModelInfo[] = []
  for (const provider of PROVIDERS) {
    const file = loadProviderFile(provider, baseDir)
    const builtins = KNOWN_MODELS.filter((m) => m.provider === provider)
    const seen = new Set<string>()

    for (const builtin of builtins) {
      const override = file.models?.[builtin.id]
      seen.add(builtin.id)
      merged.push({
        ...builtin,
        ...(override?.description ? { description: override.description } : {}),
        ...(override?.pricing ? { pricing: override.pricing } : {}),
        ...(override?.pricingNote ? { pricingNote: override.pricingNote } : {}),
        ...(override?.options ? { options: override.options } : {}),
      })
    }
    for (const [id, entry] of Object.entries(file.models ?? {})) {
      if (seen.has(id)) continue
      if (!entry.pricing) {
        throw new Error(`Provider config for ${provider}: custom model "${id}" needs a pricing block`)
      }
      merged.push({
        id,
        provider,
        description: entry.description ?? "(custom model from provider config)",
        pricing: entry.pricing,
        pricingNote: entry.pricingNote,
        options: entry.options,
        custom: true,
      })
    }
  }
  return merged
}

export function getModelInfo(modelId: string, baseDir = DEFAULT_PROVIDER_CONFIG_DIR): ModelInfo | undefined {
  return getAllModels(baseDir).find((m) => m.id === modelId)
}

/** Infer the provider for a model id — config files first, then prefix heuristic. */
export function resolveProvider(modelId: string, baseDir = DEFAULT_PROVIDER_CONFIG_DIR): Provider {
  const known = getModelInfo(modelId, baseDir)
  if (known) return known.provider
  return modelId.startsWith("gpt-") || modelId.startsWith("o1") || modelId.startsWith("o3")
    ? "openai"
    : "google"
}

// ─── model setup resolution (CLI > env > config file > built-in) ─────────────

export interface ResolveModelSetupArgs {
  /** -m flag */
  model?: string
  /** --provider flag — picks that provider's defaultModel when -m is absent */
  provider?: string
  /** -t flag */
  thinkingBudget?: number
  /** MODEL_NAME env, only when explicitly set */
  envModel?: string
  /** THINKING_BUDGET env, only when explicitly set */
  envThinkingBudget?: number
  baseDir?: string
}

export interface ModelSetup {
  model: string
  provider: Provider
  thinkingBudget: number
  /** Merged generation settings: provider-wide < per-model (thinkingBudget excluded) */
  options: Omit<ModelOptions, "thinkingBudget">
  info?: ModelInfo
}

export function resolveModelSetup(args: ResolveModelSetupArgs = {}): ModelSetup {
  const baseDir = args.baseDir ?? DEFAULT_PROVIDER_CONFIG_DIR

  let requestedProvider: Provider | undefined
  if (args.provider !== undefined) {
    if (!PROVIDERS.includes(args.provider as Provider)) {
      throw new Error(`Unknown provider "${args.provider}" — available: ${PROVIDERS.join(", ")}`)
    }
    requestedProvider = args.provider as Provider
  }

  // An explicit --provider flag outranks the ambient MODEL_NAME env var:
  // it selects that provider's configured default model.
  let model: string
  if (args.model !== undefined) {
    model = args.model
  } else if (requestedProvider !== undefined) {
    model =
      loadProviderFile(requestedProvider, baseDir).defaultModel ??
      KNOWN_MODELS.find((m) => m.provider === requestedProvider)!.id
  } else {
    model = args.envModel ?? loadProviderFile("google", baseDir).defaultModel ?? "gemini-2.0-flash"
  }

  const provider = resolveProvider(model, baseDir)
  const file = loadProviderFile(provider, baseDir)
  const modelOptions = file.models?.[model]?.options
  const providerOptionsBlock = file.options

  const thinkingBudget =
    args.thinkingBudget ??
    args.envThinkingBudget ??
    modelOptions?.thinkingBudget ??
    providerOptionsBlock?.thinkingBudget ??
    0

  const { thinkingBudget: _p, providerOptions: providerLevelRaw, ...providerRest } = providerOptionsBlock ?? {}
  const { thinkingBudget: _m, providerOptions: modelLevelRaw, ...modelRest } = modelOptions ?? {}
  const providerOptions =
    providerLevelRaw || modelLevelRaw ? { ...providerLevelRaw, ...modelLevelRaw } : undefined

  return {
    model,
    provider,
    thinkingBudget,
    options: {
      ...providerRest,
      ...modelRest,
      ...(providerOptions ? { providerOptions } : {}),
    },
    info: getModelInfo(model, baseDir),
  }
}

// ─── cost estimation ──────────────────────────────────────────────────────────

export interface CostUsage {
  inputTokens: number
  outputTokens: number
  /** How many of the input tokens were audio — unknown means all of them */
  audioInputTokens?: number
}

/**
 * Estimate the USD cost of one request. When the audio/text input split is
 * unknown, every input token is billed at the audio rate — a slight
 * overestimate, since the text part of a transcription prompt is small.
 * Returns undefined for models without pricing data.
 */
export function estimateCostUsd(
  modelId: string,
  usage: CostUsage,
  baseDir = DEFAULT_PROVIDER_CONFIG_DIR,
): number | undefined {
  const info = getModelInfo(modelId, baseDir)
  if (!info) return undefined

  const audioTokens = Math.min(usage.audioInputTokens ?? usage.inputTokens, usage.inputTokens)
  const textTokens = usage.inputTokens - audioTokens

  const cost =
    (textTokens * info.pricing.inputPer1M +
      audioTokens * info.pricing.audioInputPer1M +
      usage.outputTokens * info.pricing.outputPer1M) /
    1_000_000

  return Math.round(cost * 1e6) / 1e6
}
