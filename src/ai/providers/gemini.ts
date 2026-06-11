import type { Sample, AiResult } from "../../core/types"
import type { ASRProvider, ASRProviderConfig } from "../types"
import { loadPrompts } from "../prompts"
import { createModel } from "../client"
import { invokeModelWithRetry } from "../invoke"

export class GeminiProvider implements ASRProvider {
  name = "gemini"
  version = "2.0.0"
  private model: ReturnType<typeof createModel>

  constructor(config: ASRProviderConfig) {
    this.model = createModel({
      model: config.model,
      thinkingBudget: config.thinkingBudget ?? 0,
      apiKey: config.apiKey,
    })
  }

  async transcribe(sample: Sample): Promise<AiResult> {
    const prompts = await loadPrompts(sample.durationSeconds)
    return await invokeModelWithRetry(this.model, sample, prompts)
  }
}

export function createGeminiProvider(config: ASRProviderConfig): ASRProvider {
  return new GeminiProvider(config)
}
