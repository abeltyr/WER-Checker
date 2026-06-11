import type { ModelOptions } from "../core/types"
import type { LanguageModel } from "ai"

export interface ModelConfig {
  model: string
  thinkingBudget: number
  /** Google Gemini API key */
  apiKey: string
  /** Required only when the model resolves to OpenAI */
  openaiApiKey?: string
  /** Custom generation settings from the provider config file */
  options?: Omit<ModelOptions, "thinkingBudget">
}

export interface ConfiguredModel {
  model: LanguageModel
  /** The requested model id — used for pricing lookups */
  modelId: string
  /** Passed to generateText — provider-specific config (thinking, safety, …) */
  providerOptions?: Record<string, Record<string, unknown>>
  /** Standard generation settings passed straight to generateText */
  callSettings?: { temperature?: number; topP?: number; maxOutputTokens?: number }
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
