import type { RunConfig, SampleReport } from "../core/types"
import type { DataSource } from "../sources/types"
import type { Sample } from "../core/types"
import { openResultsDb } from "../storage/db"
import { writeJson } from "../storage"
import { join } from "node:path"
import { mkdir } from "node:fs/promises"
import { loadPrompts } from "../ai/prompts"
import { createModel } from "../ai/client"
import { invokeModelWithRetry } from "../ai/invoke"
import { compareAll } from "../analysis/index"
import { writeSampleReport } from "../report/sample"
import { writeSummaryReport } from "../report/summary"
import { CheckpointManager } from "../checkpoint"
import { MemoryMonitor, logMemoryUsage, forceGarbageCollection } from "../utils/memory"
import { metricsCollector } from "../utils/metrics"
import { writeFile } from "node:fs/promises"
import pMap from "p-map"

export interface PipelineConfig extends RunConfig {
  geminiApiKey: string
  openaiApiKey?: string
  hasabApiKey?: string
  resume?: string
  /** Re-test samples even if this model+thinking combination already has results */
  retest?: boolean
}

/** Injectable seams for tests — production callers omit this. */
export interface PipelineDeps {
  invoke?: typeof invokeModelWithRetry
}

export async function runPipeline(
  config: PipelineConfig,
  source: DataSource,
  deps?: PipelineDeps,
): Promise<void> {
  const db = openResultsDb(config.outputDir)
  const memoryMonitor = new MemoryMonitor({ heapUsedMB: 500, rssMB: 1500 })
  memoryMonitor.start(30000)
  try {
    await runPipelineWithDb(db, config, source, deps)
  } finally {
    memoryMonitor.stop()
    db.close()
  }
}

async function runPipelineWithDb(
  db: ReturnType<typeof openResultsDb>,
  config: PipelineConfig,
  source: DataSource,
  deps?: PipelineDeps,
): Promise<void> {
  const invoke = deps?.invoke ?? invokeModelWithRetry
  const runId = config.resume ?? getRunId()
  const checkpointManager = new CheckpointManager(db, runId)

  // Reports are persisted to disk and the database — they must never carry
  // credentials or run-control flags, only the reproducible RunConfig.
  const { geminiApiKey: _key, openaiApiKey: _okey, hasabApiKey: _hkey, resume: _resume, retest: _retest, ...reportConfig } = config

  let checkpoint = checkpointManager.load()

  if (checkpoint && !config.resume) {
    console.log(`[runner] found existing checkpoint for ${runId}, starting fresh`)
    checkpointManager.reset()
    checkpoint = null
  }

  console.log(`[runner] discovering files with pattern: ${config.dataPattern}`)
  const discovery = await source.discover(config.dataPattern)
  const files = discovery.files
  console.log(`[runner] found ${files.length} file(s)`)

  const model = createModel({
    model: config.model,
    thinkingBudget: config.thinkingBudget,
    apiKey: config.geminiApiKey,
    openaiApiKey: config.openaiApiKey,
    hasabApiKey: config.hasabApiKey,
    options: config.modelOptions,
  })

  metricsCollector.reset()

  const allSamples: SampleReport[] = []
  const limit = config.maxSamples ?? Infinity

  // Samples that already have a successful result for this exact
  // model + thinking combination (in ANY previous run) are skipped, so
  // repeated runs walk forward through the dataset instead of re-testing
  // the same clips. --retest overrides.
  const tested = config.retest
    ? new Set<string>()
    : db.getTestedSampleIds(config.model, config.thinkingBudget)
  if (tested.size > 0) {
    console.log(`[runner] ${tested.size} sample(s) already tested with model=${config.model} thinking=${config.thinkingBudget} — skipping those (use --retest to force)`)
  }

  // Load only as many samples as the run still needs — without the running
  // `remaining` count, every file would be asked for the full maxSamples.
  const allSampleBatches: Sample[][] = []
  let remaining = limit
  for (const filePath of discovery.files) {
    if (remaining <= 0) break
    // With prior results around, the limit cannot be pushed down into the
    // source: the first N rows might all be already-tested. Load the file
    // fully, drop tested samples, then cut to the limit.
    const loadResult = await source.load(
      filePath,
      tested.size === 0 && Number.isFinite(remaining) ? { limit: remaining } : {},
    )
    const fresh = loadResult.samples.filter((s) => !tested.has(s.id))
    const skipped = loadResult.samples.length - fresh.length
    console.log(`[runner] loaded ${loadResult.samples.length} sample(s) from ${filePath}${skipped > 0 ? ` (${skipped} already tested)` : ""}`)
    if (loadResult.metadata.errors.length > 0) {
      console.warn(`[runner] ${loadResult.metadata.errors.length} errors during load`)
    }
    allSampleBatches.push(fresh)
    remaining -= fresh.length
  }

  const totalSamples = allSampleBatches.flat().slice(0, limit)
  checkpointManager.setTotalSamples(totalSamples.length)

  // JSON mirror of the checkpoint, serialised through a promise chain so
  // concurrent samples never produce a torn file. SQLite stays the source
  // of truth for resume; the JSON is for humans.
  let checkpointJsonChain = Promise.resolve()
  const mirrorCheckpointJson = () => {
    checkpointJsonChain = checkpointJsonChain
      .then(() => writeJson(join(config.outputDir, runId, "checkpoint.json"), checkpointManager.getCheckpoint()))
      .catch((err) => console.warn(`[runner] checkpoint.json mirror failed: ${err}`))
    return checkpointJsonChain
  }

  if (checkpoint) {
    console.log(`[runner] resuming from checkpoint: ${checkpoint.processedSampleIds.length} already processed, ${checkpoint.failedSampleIds.length} failed (will retry)`)

    // Pull previously written reports back in so the summary covers the whole run,
    // not just the samples processed after the resume.
    const processedIds = new Set(checkpoint.processedSampleIds)
    for (const report of db.getSampleReports(runId)) {
      if (processedIds.has(report.sample.id)) {
        allSamples.push(report)
      }
    }
    console.log(`[runner] preloaded ${allSamples.length} existing sample report(s)`)
  }

  // 30% of the run, but never fewer than 3 — a single transient failure in a
  // small run must not abort it.
  const circuitBreakerThreshold = Math.max(3, Math.floor(totalSamples.length * 0.3))

  await pMap(
    totalSamples,
    async (sample, index) => {
      const failedCount = checkpointManager.getFailedCount()
      if (failedCount > circuitBreakerThreshold) {
        throw new Error(`Circuit breaker triggered: ${failedCount} failures (30% threshold)`)
      }

      if (checkpointManager.isProcessed(sample.id)) {
        console.log(`[runner] skipping ${sample.id} (already processed)`)
        return null
      }

      console.log(`[runner] [${index + 1}/${totalSamples.length}] ${sample.id} (dialect: ${sample.dialect})`)

      const prompts = await loadPrompts(sample.durationSeconds)

      const ai = await invoke(model, sample, prompts, { timeoutMs: config.requestTimeoutMs })
      if (!ai.success) {
        console.warn(`  FAILED: ${ai.error}`)
      }

      // SQLite upserts are cheap — persist progress after every sample so a
      // crash never loses more than the in-flight one.
      checkpointManager.markProcessed(sample.id, ai.success)
      checkpointManager.setLastProcessedIndex(index)
      checkpointManager.save()
      mirrorCheckpointJson()

      const comparison = compareAll(sample, ai)

      const report = await writeSampleReport(db, config.outputDir, runId, reportConfig, sample, ai, comparison)

      metricsCollector.recordSample({
        success: ai.success,
        wer: comparison.dimensions.text.wer,
        cer: comparison.dimensions.text.cer,
        mer: comparison.dimensions.text.mer,
        wil: comparison.dimensions.text.wil,
        bleu: comparison.dimensions.text.bleu,
        latencyMs: ai.latencyMs,
        tokensUsed: ai.tokenUsage.total,
        costUsd: ai.costUsd,
      })

      const w = comparison.dimensions.text.wer
      const cost = ai.costUsd !== undefined ? `  |  cost: $${ai.costUsd.toFixed(6)}` : ""
      console.log(`  WER: ${(w * 100).toFixed(1)}%  |  latency: ${ai.latencyMs}ms  |  tokens: ${ai.tokenUsage.input}in/${ai.tokenUsage.output}out${cost}`)

      allSamples.push(report)

      // The report is on disk and the summary only needs metadata — release
      // the audio so a long run doesn't hold every WAV in memory.
      sample.audioBuffer = Buffer.alloc(0)
      return report
    },
    { concurrency: config.concurrency, stopOnError: false }
  )

  checkpointManager.save()
  await mirrorCheckpointJson()

  forceGarbageCollection()
  logMemoryUsage("[runner] final")

  console.log(`\n[runner] generating summary report...`)
  await writeSummaryReport(db, config.outputDir, runId, reportConfig, allSamples)
  // Prometheus scrape files only make sense on the filesystem — everything
  // else lives in results.db.
  await mkdir(join(config.outputDir, runId), { recursive: true })
  await writeFile(
    join(config.outputDir, runId, "metrics.prom"),
    metricsCollector.toPrometheusFormat() + "\n",
    "utf-8",
  )
  console.log(`[runner] done — ${allSamples.filter(s => s.ai.success).length} successful, ${allSamples.filter(s => !s.ai.success).length} failed`)
}

function getRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}
