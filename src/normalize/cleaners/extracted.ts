import { join, resolve } from "node:path"
import { open, stat } from "node:fs/promises"
import { readJson } from "../../storage"
import { decodeWavBytes } from "../../sources/parquet/audio"
import type { ManifestEntry } from "../../extract"
import type { Cleaner, CleanedEntry, CleanReport } from "../types"

const VALID_GENDERS = new Set(["male", "female"])

/**
 * Cleanup case for `wer extract` output: a directory holding one big
 * manifest.json plus audio/*.wav files. Every entry is validated against its
 * WAV on disk; the WAV header is authoritative for sampleRate/duration.
 */
export const extractedCleaner: Cleaner = {
  name: "extracted",
  description: "data/extracted layout — manifest.json + audio/*.wav from `wer extract`",

  async clean(inputDir: string): Promise<CleanReport> {
    const manifest = await readJson<ManifestEntry[]>(join(inputDir, "manifest.json"))

    const entries: CleanedEntry[] = []
    const skipped: Array<{ id: string; reason: string }> = []
    const seen = new Set<string>()

    for (const raw of manifest) {
      const id = raw.id?.trim()
      if (!id) {
        skipped.push({ id: `row_${raw.rowIndex}`, reason: "missing id" })
        continue
      }
      if (seen.has(id)) {
        skipped.push({ id, reason: "duplicate id" })
        continue
      }

      const text = normaliseText(raw.text)
      if (!text) {
        skipped.push({ id, reason: "empty transcript" })
        continue
      }

      if (!raw.audioFile) {
        skipped.push({ id, reason: "no audio file in manifest" })
        continue
      }
      const wavPath = resolve(inputDir, raw.audioFile)

      let audioBytes: number
      try {
        audioBytes = (await stat(wavPath)).size
      } catch {
        skipped.push({ id, reason: `audio file not found: ${raw.audioFile}` })
        continue
      }

      const decoded = await decodeWavHeader(wavPath)
      if (!decoded) {
        skipped.push({ id, reason: "invalid WAV header" })
        continue
      }

      seen.add(id)
      entries.push({
        sourceWavPath: wavPath,
        point: {
          id,
          audioFile: `${id}.wav`,
          text,
          dialect: normaliseLabel(raw.dialect) ?? "unknown",
          gender: normaliseGender(raw.gender),
          speakerId: raw.speakerId?.trim() || "unknown",
          // The source corpus is single-speaker read speech
          speakerCount: 1,
          durationSeconds: decoded.durationSeconds,
          sampleRate: decoded.sampleRate,
          audioBytes,
          source: { case: "extracted", file: raw.sourceFile, rowIndex: raw.rowIndex },
        },
      })
    }

    return { entries, skipped }
  },
}

/** Collapse runs of whitespace — the WER tokeniser splits on whitespace anyway. */
function normaliseText(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim()
}

function normaliseLabel(value: string | undefined): string | undefined {
  const cleaned = value?.trim().toLowerCase()
  return cleaned || undefined
}

function normaliseGender(value: string | undefined): string {
  const cleaned = normaliseLabel(value)
  return cleaned && VALID_GENDERS.has(cleaned) ? cleaned : "unknown"
}

/** Read only the 44-byte canonical header instead of the whole file. */
async function decodeWavHeader(wavPath: string) {
  const handle = await open(wavPath, "r")
  try {
    const header = Buffer.alloc(44)
    const { bytesRead } = await handle.read(header, 0, 44, 0)
    if (bytesRead < 44) return null
    return decodeWavBytes(header)
  } finally {
    await handle.close()
  }
}
