import type { ResultsDb } from "../storage/db"

export interface Checkpoint {
  runId: string
  timestamp: string
  processedSampleIds: string[]
  failedSampleIds: string[]
  totalSamples: number
  lastProcessedIndex: number
}

/**
 * Checkpoint state backed by the SQLite results database. Every
 * markProcessed() is persisted immediately, so a crash loses at most the
 * sample that was in flight — there is no batched JSON rewrite anymore.
 */
export class CheckpointManager {
  private readonly db: ResultsDb
  private readonly runId: string
  // Sets keep membership checks O(1); SQLite holds the durable copy.
  private processed = new Set<string>()
  private failed = new Set<string>()
  private totalSamples = 0
  private lastProcessedIndex = -1

  constructor(db: ResultsDb, runId: string) {
    this.db = db
    this.runId = runId
  }

  load(): Checkpoint | null {
    const row = this.db.getCheckpoint(this.runId)
    if (!row) return null

    this.processed = new Set<string>()
    this.failed = new Set<string>()
    for (const sample of this.db.getCheckpointSamples(this.runId)) {
      if (sample.success) this.processed.add(sample.sampleId)
      else this.failed.add(sample.sampleId)
    }
    this.totalSamples = row.totalSamples
    this.lastProcessedIndex = row.lastProcessedIndex
    return this.getCheckpoint()
  }

  save(): void {
    this.db.upsertCheckpoint({
      runId: this.runId,
      timestamp: new Date().toISOString(),
      totalSamples: this.totalSamples,
      lastProcessedIndex: this.lastProcessedIndex,
    })
  }

  /** Discard any previously loaded state, in memory and in the database. */
  reset(): void {
    this.processed.clear()
    this.failed.clear()
    this.totalSamples = 0
    this.lastProcessedIndex = -1
    this.db.deleteCheckpoint(this.runId)
  }

  markProcessed(sampleId: string, success: boolean): void {
    if (success) {
      this.processed.add(sampleId)
      this.failed.delete(sampleId)
    } else {
      this.failed.add(sampleId)
    }
    this.db.markCheckpointSample(this.runId, sampleId, success)
  }

  setTotalSamples(total: number): void {
    this.totalSamples = total
  }

  setLastProcessedIndex(index: number): void {
    this.lastProcessedIndex = index
  }

  /** Only successful samples count as processed — failed ones are retried on resume. */
  isProcessed(sampleId: string): boolean {
    return this.processed.has(sampleId)
  }

  getProcessedCount(): number {
    return this.processed.size
  }

  getFailedCount(): number {
    return this.failed.size
  }

  getCheckpoint(): Checkpoint {
    return {
      runId: this.runId,
      timestamp: new Date().toISOString(),
      processedSampleIds: [...this.processed],
      failedSampleIds: [...this.failed],
      totalSamples: this.totalSamples,
      lastProcessedIndex: this.lastProcessedIndex,
    }
  }
}
