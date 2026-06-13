import type { ModelConfig, ConfiguredModel, TranscriptionResult } from "../types"
import type { Sample } from "../../core/types"

const DEFAULT_BASE_URL = "https://api.hasab.ai/api/v1"
// The whole tool evaluates Amharic ASR — tell Hasab the source language so it
// doesn't fall back to auto-detection. Overridable for other datasets.
const DEFAULT_SOURCE_LANGUAGE = "amh"

/** Map common audio MIME types to the file extension Hasab expects (MP3/WAV/M4A). */
function extensionFor(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3"
    case "audio/mp4":
    case "audio/x-m4a":
    case "audio/m4a":
      return "m4a"
    default:
      return "wav"
  }
}

/**
 * Configure a Hasab AI transcription model.
 *
 * Unlike the Gemini/OpenAI providers, Hasab is a dedicated speech-to-text REST
 * API (POST multipart/form-data to /upload-audio, Bearer auth) that returns a
 * transcription directly — it does not go through the AI SDK's
 * generateText/LanguageModel path, so it is modelled as a transcription
 * provider. Hasab does not predict gender/dialect/speaker count, so those
 * comparison dimensions are left blank and only the text metrics (WER/CER/…)
 * are meaningful for it.
 */
export function createHasabModel(cfg: ModelConfig): ConfiguredModel {
  if (!cfg.hasabApiKey) {
    throw new Error(`Model "${cfg.model}" needs a Hasab key — set HASAB_API_KEY in .env`)
  }
  const apiKey = cfg.hasabApiKey
  // Base URL / source language aren't secrets — read them from the environment
  // with sensible defaults rather than threading them through every config type.
  const baseUrl = (process.env.HASAB_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "")
  const sourceLanguage = process.env.HASAB_SOURCE_LANGUAGE || DEFAULT_SOURCE_LANGUAGE

  return {
    modelId: cfg.model,
    async transcribe(sample: Sample, signal: AbortSignal): Promise<TranscriptionResult> {
      const form = new FormData()
      const filename = `${sample.id}.${extensionFor(sample.audioMimeType)}`
      form.append("audio", new Blob([sample.audioBuffer], { type: sample.audioMimeType }), filename)
      form.append("transcribe", "true")
      form.append("translate", "false")
      form.append("summarize", "false")
      form.append("source_language", sourceLanguage)

      const res = await fetch(`${baseUrl}/upload-audio`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal,
      })

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`Hasab API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`)
      }

      const json = (await res.json()) as {
        transcription?: string
        text?: string
        tokens_used?: number
        success?: boolean
      }

      // A non-2xx is the usual failure signal, but guard the explicit flag too
      // so a 200-with-error body is retried instead of recorded as empty text.
      if (json.success === false) {
        throw new Error(`Hasab transcription failed: ${JSON.stringify(json).slice(0, 500)}`)
      }

      return {
        transcription: json.transcription ?? json.text ?? "",
        raw: json,
        tokensUsed: typeof json.tokens_used === "number" ? json.tokens_used : undefined,
        modelVersion: cfg.model,
      }
    },
  }
}
