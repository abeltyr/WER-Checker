import { join } from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import type { DataSource } from "../sources/types"
import { writeJson } from "../storage"

export interface ExtractConfig {
  dataPattern: string
  outputDir: string
  maxSamples?: number
  /** Rows to skip at the start of each parquet file */
  offset?: number
  /** Write a .wav file per sample (default true) — manifest is always written */
  audio: boolean
}

export interface ManifestEntry {
  id: string
  text: string | undefined
  dialect: string
  gender: string | undefined
  speakerId: string | undefined
  durationSeconds: number
  sampleRate: number
  audioBytes: number
  audioFile?: string
  sourceFile: string
  rowIndex: number
}

export interface ExtractResult {
  count: number
  files: number
  manifestPath: string
}

/**
 * Extract samples (audio + transcripts + metadata) from parquet files to disk
 * without invoking any AI model. Output layout:
 *
 *   <outputDir>/
 *   ├── audio/<sampleId>.wav    one complete WAV file per sample
 *   └── manifest.json           text + metadata for every extracted sample
 */
export async function runExtraction(
  config: ExtractConfig,
  source: DataSource,
): Promise<ExtractResult> {
  const discovery = await source.discover(config.dataPattern)
  console.log(`[extract] found ${discovery.files.length} file(s) for pattern: ${config.dataPattern}`)

  const audioDir = join(config.outputDir, "audio")
  if (config.audio) {
    await mkdir(audioDir, { recursive: true })
  }

  const manifest: ManifestEntry[] = []
  let remaining = config.maxSamples ?? Infinity

  for (const filePath of discovery.files) {
    if (remaining <= 0) break

    const { samples } = await source.load(filePath, {
      limit: Number.isFinite(remaining) ? remaining : undefined,
      offset: config.offset,
    })
    console.log(`[extract] loaded ${samples.length} sample(s) from ${filePath}`)

    for (const sample of samples) {
      if (remaining <= 0) break

      const audioFile = join("audio", `${sample.id}.wav`)
      if (config.audio) {
        await writeFile(join(config.outputDir, audioFile), sample.audioBuffer)
      }

      manifest.push({
        id: sample.id,
        text: sample.metadata.text as string | undefined,
        dialect: sample.dialect,
        gender: sample.metadata.gender as string | undefined,
        speakerId: sample.metadata.speaker_id as string | undefined,
        durationSeconds: sample.durationSeconds,
        sampleRate: sample.sampleRate,
        audioBytes: sample.audioBuffer.length,
        ...(config.audio ? { audioFile } : {}),
        sourceFile: filePath,
        rowIndex: sample.rowIndex,
      })
      remaining--
    }
  }

  const manifestPath = join(config.outputDir, "manifest.json")
  await writeJson(manifestPath, manifest)

  return { count: manifest.length, files: discovery.files.length, manifestPath }
}
