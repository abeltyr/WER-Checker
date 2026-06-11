import type { Sample, AiResult, Comparison, GeminiOutput } from "../core/types"
import { computeTextDimension } from "./compare"

/**
 * Run every comparison dimension against a single sample+result pair.
 *
 * Dimensions covered:
 *   text    — WER / CER between reference and predicted transcription
 *   gender  — dataset gender vs predicted gender
 *   dialect — dataset dialect vs predicted dialect
 *   speaker — speaker count in reference vs predicted
 *
 * The model output is the loosely-parsed JSON response, so every field is
 * type-checked before use rather than trusted.
 */
export function compareAll(sample: Sample, ai: AiResult): Comparison {
  const refText = (sample.metadata.text as string) ?? ""
  const refGender = (sample.metadata.gender as string) ?? "unknown"
  const refDialect = (sample.metadata.dialect as string) ?? sample.dialect
  const refSpeakers = asCount(sample.metadata.speaker_count) ?? 1

  const output = ai.parsedResponse
  const hypText = asText(output?.transcription)
  const hypGender = asLabel(output?.gender)
  const hypDialect = asLabel(output?.dialect)
  const hypSpeakers = asCount(output?.speaker_count) ?? 0

  return {
    sampleId: sample.id,
    dimensions: {
      text: computeTextDimension(refText, hypText),
      gender: {
        reference: refGender,
        predicted: hypGender,
        match: refGender.toLowerCase() === hypGender.toLowerCase(),
      },
      dialect: {
        reference: refDialect,
        predicted: hypDialect,
        match: refDialect.toLowerCase() === hypDialect.toLowerCase(),
      },
      speakerCount: {
        reference: String(refSpeakers),
        predicted: String(hypSpeakers),
        match: refSpeakers === hypSpeakers,
      },
    },
  }
}

function asText(value: GeminiOutput["transcription"] | undefined): string {
  return typeof value === "string" ? value.trim() : ""
}

function asLabel(value: string | undefined): string {
  return typeof value === "string" && value.trim() ? value.trim() : "unknown"
}

function asCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
