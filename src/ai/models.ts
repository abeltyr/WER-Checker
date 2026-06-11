export type Provider = "google" | "openai"

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
}

/**
 * Models known to handle audio transcription well, with their list pricing.
 *
 * Prices are USD per 1M tokens, last reviewed 2026-06. Audio input is billed
 * at a different (higher) rate than text on most models — verify against
 * https://ai.google.dev/pricing and https://openai.com/api/pricing when
 * vendors update.
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
    id: "gemini-2.5-pro",
    provider: "google",
    description: "Gemini 2.5 Pro — strongest Gemini for hard audio",
    pricing: { inputPer1M: 1.25, audioInputPer1M: 1.25, outputPer1M: 10.0 },
  },
  {
    id: "gemini-2.5-flash",
    provider: "google",
    description: "Gemini 2.5 Flash — good quality/cost balance",
    pricing: { inputPer1M: 0.3, audioInputPer1M: 1.0, outputPer1M: 2.5 },
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

export function getModelInfo(modelId: string): ModelInfo | undefined {
  return KNOWN_MODELS.find((m) => m.id === modelId)
}

/** Infer the provider for models that are not in the registry. */
export function resolveProvider(modelId: string): Provider {
  const known = getModelInfo(modelId)
  if (known) return known.provider
  return modelId.startsWith("gpt-") || modelId.startsWith("o1") || modelId.startsWith("o3")
    ? "openai"
    : "google"
}

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
export function estimateCostUsd(modelId: string, usage: CostUsage): number | undefined {
  const info = getModelInfo(modelId)
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
