// =============================================================================
// Canonical data point — the JSON sidecar stored next to each WAV in the
// normalized dataset (data/dataset/<id>/<id>.json). Every raw input format
// goes through a case-specific cleaner that produces exactly this shape;
// the AI evaluation only ever consumes this.
// =============================================================================
export interface DataPoint {
  id: string
  /** WAV filename inside the same sample folder */
  audioFile: string
  /** Cleaned reference transcript */
  text: string
  dialect: string
  gender: string
  speakerId: string
  speakerCount: number
  durationSeconds: number
  sampleRate: number
  audioBytes: number
  /** Provenance — which cleanup case produced this point and from what */
  source: {
    case: string
    file: string
    rowIndex?: number
  }
}

// =============================================================================
// Raw sample produced by any data-source plugin
// =============================================================================
export interface Sample {
  id: string
  source: string
  sourceFile: string
  rowIndex: number
  dialect: string

  audioBuffer: Buffer
  audioMimeType: string
  durationSeconds: number
  sampleRate: number

  /** Every column from the source — never drop data */
  metadata: Record<string, unknown>
}

// =============================================================================
// AI call telemetry
// =============================================================================
export interface AiResult {
  sampleId: string
  success: boolean
  error?: string
  latencyMs: number
  tokenUsage: {
    input: number
    output: number
    total: number
    /** Audio share of the input tokens, when the provider reports it */
    audioInput?: number
  }
  /** Estimated request cost in USD — absent for models without pricing data */
  costUsd?: number
  modelVersion: string
  rawResponse: unknown
  parsedResponse?: GeminiOutput
}

/**
 * Model output — deliberately minimal: only the fields that are actually
 * compared against the dataset reference (text, gender, dialect, speakers).
 */
export interface GeminiOutput {
  transcription: string
  gender: string
  dialect: string
  speaker_count: number
}

// =============================================================================
// Comparison results — multi-dimension
// =============================================================================
export interface Comparison {
  sampleId: string
  dimensions: {
    text: TextDimension
    gender: MatchDimension
    dialect: MatchDimension
    speakerCount: MatchDimension
  }
}

export interface TextDimension {
  referenceText: string
  hypothesisText: string
  wordCount: { reference: number; hypothesis: number }
  errors: { substitutions: number; deletions: number; insertions: number; total: number }
  wer: number
  cer: number
  mer: number
  wil: number
  bleu: number
}

export interface MatchDimension {
  reference: string
  predicted: string
  match: boolean
}

// =============================================================================
// Reports
// =============================================================================

/** Sample as persisted in reports — audio bytes are replaced by their size. */
export type ReportSample = Omit<Sample, "audioBuffer"> & { audioBytes: number }

export function toReportSample(sample: Sample): ReportSample {
  const { audioBuffer, ...rest } = sample
  return { ...rest, audioBytes: audioBuffer.length }
}

export interface SampleReport {
  runId: string
  timestamp: string
  config: RunConfig
  sample: ReportSample
  ai: AiResult
  comparison: Comparison
}

/**
 * Custom per-model/per-provider generation settings, configured in
 * config/providers/<provider>.json or resolved from CLI flags.
 */
export interface ModelOptions {
  thinkingBudget?: number
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  /** Raw passthrough to the AI SDK's providerOptions, e.g. { google: { safetySettings: [...] } } */
  providerOptions?: Record<string, Record<string, unknown>>
}

export interface RunConfig {
  model: string
  thinkingBudget: number
  /** Extra generation settings from the provider config file (no secrets) */
  modelOptions?: Omit<ModelOptions, "thinkingBudget">
  maxSamples?: number
  concurrency: number
  dataPattern: string
  outputDir: string
  /** Hard per-request deadline for AI calls (default 120 000) */
  requestTimeoutMs?: number
}

export interface SummaryReport {
  runId: string
  timestamp: string
  config: RunConfig
  totalSamples: number
  successfulSamples: number
  failedSamples: number
  overall: MetricSummary
  byDialect: Record<string, MetricSummary>
  byGender: Record<string, MetricSummary>
  byPredictedGender: Record<string, MetricSummary>
  byGenderMatch: Record<string, MetricSummary>
  byDialectMatch: Record<string, MetricSummary>
  sampleIds: string[]
}

export interface MetricSummary {
  count: number
  avgWER: number
  minWER: number
  maxWER: number
  avgCER: number
  avgMER: number
  avgWIL: number
  avgBLEU: number
  avgLatencyMs: number
  totalTokens: number
  totalInputTokens: number
  totalOutputTokens: number
  avgTokens: number
  totalCostUsd: number
  avgCostUsd: number
  genderMatchRate?: number
  dialectMatchRate?: number
}
