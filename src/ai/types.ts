import type { ModelOptions, Sample } from "../core/types"
import type { LanguageModel } from "ai"

export interface ModelConfig {
  model: string
  thinkingBudget: number
  /** Google Gemini API key */
  apiKey: string
  /** Required only when the model resolves to OpenAI */
  openaiApiKey?: string
  /** Required only when the model resolves to Hasab */
  hasabApiKey?: string
  /** Custom generation settings from the provider config file */
  options?: Omit<ModelOptions, "thinkingBudget">
}

/**
 * Result of a dedicated transcription provider (e.g. Hasab) — a speech-to-text
 * REST API that returns text directly rather than going through the AI SDK's
 * generateText/LanguageModel path.
 */
export interface TranscriptionResult {
  transcription: string
  /** Verbatim provider response, persisted as the raw response */
  raw: unknown
  /** Provider-reported token usage, when available — not token-billed otherwise */
  tokensUsed?: number
  /** Provider/model version string for telemetry */
  modelVersion?: string
}

export interface ConfiguredModel {
  /** The requested model id — used for pricing lookups */
  modelId: string
  /** AI-SDK language model — present for LLM providers (Gemini, OpenAI) */
  model?: LanguageModel
  /** Passed to generateText — provider-specific config (thinking, safety, …) */
  providerOptions?: Record<string, Record<string, unknown>>
  /** Standard generation settings passed straight to generateText */
  callSettings?: { temperature?: number; topP?: number; maxOutputTokens?: number }
  /**
   * Dedicated speech-to-text call — present for transcription providers (Hasab)
   * instead of `model`. When set, invoke uses this rather than generateText.
   */
  transcribe?: (sample: Sample, signal: AbortSignal) => Promise<TranscriptionResult>
}

/** Map config-file options onto the generateText call settings. */
export function buildCallSettings(
  options: Omit<ModelOptions, "thinkingBudget"> | undefined,
): ConfiguredModel["callSettings"] {
  if (!options) return undefined
  const settings: NonNullable<ConfiguredModel["callSettings"]> = {}
  if (options.temperature !== undefined) settings.temperature = options.temperature
  if (options.topP !== undefined) settings.topP = options.topP
  if (options.maxOutputTokens !== undefined) settings.maxOutputTokens = options.maxOutputTokens
  return Object.keys(settings).length > 0 ? settings : undefined
}
