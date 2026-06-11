import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { buildCallSettings } from "../types"
import type { ModelConfig, ConfiguredModel } from "../types"

/** Configure a Google Gemini model: API key, thinking budget, custom options. */
export function createGoogleModel(cfg: ModelConfig): ConfiguredModel {
  if (!cfg.apiKey) {
    throw new Error(`Model "${cfg.model}" needs a Gemini key — set GEMINI_API_KEY in .env`)
  }
  const google = createGoogleGenerativeAI({ apiKey: cfg.apiKey })

  let providerOptions = cfg.options?.providerOptions
  if (cfg.thinkingBudget > 0) {
    providerOptions = {
      ...providerOptions,
      google: {
        ...providerOptions?.google,
        thinkingConfig: { thinkingBudget: cfg.thinkingBudget },
      },
    }
  }

  return {
    model: google(cfg.model),
    modelId: cfg.model,
    providerOptions,
    callSettings: buildCallSettings(cfg.options),
  }
}
