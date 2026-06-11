import { createOpenAI } from "@ai-sdk/openai"
import { buildCallSettings } from "../types"
import type { ModelConfig, ConfiguredModel } from "../types"

/** Configure an OpenAI audio model: API key and custom options. */
export function createOpenAIModel(cfg: ModelConfig): ConfiguredModel {
  if (!cfg.openaiApiKey) {
    throw new Error(`Model "${cfg.model}" needs an OpenAI key — set OPENAI_API_KEY in .env`)
  }
  const openai = createOpenAI({ apiKey: cfg.openaiApiKey })

  // thinkingBudget is a Gemini concept — OpenAI models ignore it
  return {
    model: openai(cfg.model),
    modelId: cfg.model,
    providerOptions: cfg.options?.providerOptions,
    callSettings: buildCallSettings(cfg.options),
  }
}
