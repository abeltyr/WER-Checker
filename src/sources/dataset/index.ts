import { join } from "node:path"
import { readdir, readFile, stat } from "node:fs/promises"
import { readJson } from "../../storage"
import type { DataPoint, Sample } from "../../core/types"
import type { DataSource, DiscoveryResult, LoadOptions, LoadResult, ValidationResult } from "../types"

/**
 * Data source for the canonical dataset layout written by `wer normalize`:
 * one folder per sample containing <id>.wav + <id>.json. The pattern is the
 * dataset root directory; each sample is self-contained, so matching audio
 * to its metadata never requires scanning a shared manifest.
 */
export const datasetSource: DataSource = {
  name: "dataset",
  version: "1.0.0",
  capabilities: {
    streaming: false,
    batching: true,
    filtering: true,
    validation: true,
  },

  discover: async (pattern: string): Promise<DiscoveryResult> => {
    try {
      const stats = await stat(pattern)
      if (!stats.isDirectory()) {
        return { files: [], errors: [{ path: pattern, reason: "not a directory" }] }
      }
    } catch {
      return { files: [], errors: [{ path: pattern, reason: "directory not found" }] }
    }
    // The whole dataset directory is one loadable unit
    return { files: [pattern], errors: [] }
  },

  load: async (datasetDir: string, options?: LoadOptions): Promise<LoadResult> => {
    const ids = await listSampleIds(datasetDir)

    const offset = options?.offset ?? 0
    const end = options?.limit !== undefined ? offset + options.limit : ids.length
    const window = ids.slice(offset, end)

    const samples: Sample[] = []
    const errors: Array<{ row: number; reason: string }> = []

    for (const [windowIndex, id] of window.entries()) {
      const rowIndex = offset + windowIndex
      try {
        const sample = await loadSample(datasetDir, id, rowIndex)
        if (options?.filter && !options.filter(sample)) continue
        samples.push(sample)
      } catch (err) {
        errors.push({ row: rowIndex, reason: err instanceof Error ? err.message : String(err) })
      }
    }

    return {
      samples,
      metadata: {
        totalRows: ids.length,
        loadedRows: samples.length,
        skippedRows: window.length - samples.length,
        errors,
      },
    }
  },

  validate: async (datasetDir: string): Promise<ValidationResult> => {
    try {
      const ids = await listSampleIds(datasetDir)
      if (ids.length === 0) {
        return { valid: false, missingColumns: [], errors: ["no sample folders found"] }
      }

      // Spot-check the first data point for the canonical structure
      const point = await readJson<DataPoint>(join(datasetDir, ids[0]!, `${ids[0]}.json`))
      const required: Array<keyof DataPoint> = ["id", "audioFile", "text", "dialect", "gender"]
      const missing = required.filter((key) => point[key] === undefined)

      return {
        valid: missing.length === 0,
        missingColumns: missing as string[],
        errors: missing.length > 0 ? [`Data point missing fields: ${missing.join(", ")}`] : [],
      }
    } catch (err) {
      return {
        valid: false,
        missingColumns: [],
        errors: [err instanceof Error ? err.message : String(err)],
      }
    }
  },
}

/** Sample folders sorted by id so runs are deterministic. */
async function listSampleIds(datasetDir: string): Promise<string[]> {
  const entries = await readdir(datasetDir, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

async function loadSample(datasetDir: string, id: string, rowIndex: number): Promise<Sample> {
  const sampleDir = join(datasetDir, id)
  const jsonPath = join(sampleDir, `${id}.json`)
  const point = await readJson<DataPoint>(jsonPath)
  const audioBuffer = await readFile(join(sampleDir, point.audioFile))

  return {
    id: point.id,
    source: "dataset",
    sourceFile: jsonPath,
    rowIndex,
    dialect: point.dialect,
    audioBuffer,
    audioMimeType: "audio/wav",
    durationSeconds: point.durationSeconds,
    sampleRate: point.sampleRate,
    metadata: {
      text: point.text,
      dialect: point.dialect,
      gender: point.gender,
      speaker_id: point.speakerId,
      speaker_count: point.speakerCount,
    },
  }
}
