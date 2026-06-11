import type { DataPoint } from "../core/types"

/** One cleaned sample ready to be written into the canonical dataset. */
export interface CleanedEntry {
  point: DataPoint
  /** Absolute path of the source WAV to copy into the sample folder */
  sourceWavPath: string
}

export interface CleanReport {
  entries: CleanedEntry[]
  skipped: Array<{ id: string; reason: string }>
}

/**
 * A cleanup case for one raw input format. Each incoming data shape
 * (extracted parquet manifest, scraped audio, vendor deliveries, …) gets its
 * own cleaner; all of them emit the same canonical DataPoint format.
 */
export interface Cleaner {
  /** Case name used to select this cleaner, e.g. "extracted" */
  name: string
  description: string
  clean(inputDir: string): Promise<CleanReport>
}
