import { join } from "node:path"
import { copyFile, mkdir } from "node:fs/promises"
import { writeJson } from "../storage"
import { extractedCleaner } from "./cleaners/extracted"
import type { Cleaner } from "./types"

export type { Cleaner, CleanedEntry, CleanReport } from "./types"

/** Registry of cleanup cases — add one entry per new raw-data shape. */
export const cleaners: Record<string, Cleaner> = {
  [extractedCleaner.name]: extractedCleaner,
}

export interface NormalizeConfig {
  inputDir: string
  outputDir: string
  /** Which cleanup case to apply (default: "extracted") */
  case?: string
  maxSamples?: number
}

export interface NormalizeResult {
  written: number
  skipped: Array<{ id: string; reason: string }>
  outputDir: string
}

/**
 * Turn raw input data into the canonical dataset layout used for AI testing:
 *
 *   <outputDir>/
 *   └── <sampleId>/
 *       ├── <sampleId>.wav    the audio clip
 *       └── <sampleId>.json   its DataPoint sidecar (reference text + metadata)
 *
 * One self-contained folder per data point — no shared manifest to scan.
 */
export async function runNormalize(config: NormalizeConfig): Promise<NormalizeResult> {
  const caseName = config.case ?? "extracted"
  const cleaner = cleaners[caseName]
  if (!cleaner) {
    const known = Object.keys(cleaners).join(", ")
    throw new Error(`Unknown cleanup case "${caseName}" — available: ${known}`)
  }

  console.log(`[normalize] cleaning ${config.inputDir} (case: ${caseName})`)
  const report = await cleaner.clean(config.inputDir)

  const limit = config.maxSamples ?? Infinity
  const entries = report.entries.slice(0, limit)

  for (const { point, sourceWavPath } of entries) {
    const sampleDir = join(config.outputDir, point.id)
    await mkdir(sampleDir, { recursive: true })
    await copyFile(sourceWavPath, join(sampleDir, point.audioFile))
    await writeJson(join(sampleDir, `${point.id}.json`), point)
  }

  for (const skip of report.skipped) {
    console.warn(`[normalize] skipped ${skip.id}: ${skip.reason}`)
  }
  console.log(`[normalize] wrote ${entries.length} data point(s) to ${config.outputDir} (${report.skipped.length} skipped)`)

  return { written: entries.length, skipped: report.skipped, outputDir: config.outputDir }
}
