import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { resolveProvider } from "./models"
import type { LanguageModel } from "ai"

export interface ModelConfig {
  model: string
  thinkingBudget: number
  /** Google Gemini API key */
  apiKey: string
  /** Required only when the model resolves to OpenAI */
  openaiApiKey?: string
}

export interface ConfiguredModel {
  model: LanguageModel
  /** The requested model id — used for pricing lookups */
  modelId: string
  /** Passed to generateText — thinking config must go through providerOptions in AI SDK v6 */
  providerOptions?: { google: { thinkingConfig: { thinkingBudget: number } } }
}

/**
 * Create a configured model for whichever provider the model id belongs to.
 * API keys are passed explicitly so the providers never fall back to env
 * vars that may be misconfigured.
 */
export function createModel(cfg: ModelConfig): ConfiguredModel {
  const provider = resolveProvider(cfg.model)

  if (provider === "openai") {
    if (!cfg.openaiApiKey) {
      throw new Error(`Model "${cfg.model}" needs an OpenAI key — set OPENAI_API_KEY in .env`)
    }
    const openai = createOpenAI({ apiKey: cfg.openaiApiKey })
    // thinkingBudget is a Gemini concept — OpenAI models ignore it
    return { model: openai(cfg.model), modelId: cfg.model }
  }

  if (!cfg.apiKey) {
    throw new Error(`Model "${cfg.model}" needs a Gemini key — set GEMINI_API_KEY in .env`)
  }
  const google = createGoogleGenerativeAI({ apiKey: cfg.apiKey })

  return {
    model: google(cfg.model),
    modelId: cfg.model,
    providerOptions:
      cfg.thinkingBudget > 0
        ? { google: { thinkingConfig: { thinkingBudget: cfg.thinkingBudget } } }
        : undefined,
  }
}
