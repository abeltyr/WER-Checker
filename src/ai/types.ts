import type { Sample, AiResult } from "../core/types"

export interface ASRProvider {
  name: string
  version: string
  transcribe(sample: Sample): Promise<AiResult>
}

export interface ASRProviderConfig {
  model: string
  apiKey: string
  thinkingBudget?: number
  maxRetries?: number
}

export interface ASRProviderFactory {
  create(config: ASRProviderConfig): ASRProvider
}
