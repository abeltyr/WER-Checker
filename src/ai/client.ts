import { resolveProvider } from "./models"
import { createGoogleModel, createOpenAIModel } from "./providers"
import type { ModelConfig, ConfiguredModel } from "./types"

export type { ModelConfig, ConfiguredModel } from "./types"

/**
 * Create a configured model for whichever provider the model id belongs to.
 * Each provider's specifics live in src/ai/providers/<provider>.ts; API keys
 * are passed explicitly so the SDKs never fall back to env vars that may be
 * misconfigured.
 */
export function createModel(cfg: ModelConfig): ConfiguredModel {
  return resolveProvider(cfg.model) === "openai" ? createOpenAIModel(cfg) : createGoogleModel(cfg)
}
