import { describe, it, expect, beforeEach, afterAll } from "bun:test"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { runPipeline } from "../../../src/runner"
import type { PipelineConfig } from "../../../src/runner"
import { openResultsDb, ResultsDb } from "../../../src/storage/db"
import { CheckpointManager } from "../../../src/checkpoint"
import type { DataSource } from "../../../src/sources/types"
import type { Sample, AiResult } from "../../../src/core/types"
import { makeTmpDir, makeSample, makeWav, makeGeminiOutput } from "../../helpers"

let tmp: string
const tmpDirs: string[] = []
const dbs: ResultsDb[] = []

beforeEach(async () => {
  tmp = await makeTmpDir("wer-runner-")
  tmpDirs.push(tmp)
})

afterAll(async () => {
  for (const d of dbs) d.close()
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })))
})

/** Open a fresh connection to the run's results.db for assertions. */
function openDb(): ResultsDb {
  const db = openResultsDb(tmp)
  dbs.push(db)
  return db
}

function makeSamples(count: number): Sample[] {
  return Array.from({ length: count }, (_, i) =>
    makeSample({
      id: `gonder_row_${String(i).padStart(4, "0")}`,
      rowIndex: i,
      audioBuffer: makeWav({ numSamples: 100 }),
    }),
  )
}

function makeMemorySource(samples: Sample[]): DataSource {
  return {
    name: "memory",
    version: "1.0.0",
    capabilities: { streaming: false, batching: true, filtering: false, validation: false },
    discover: async () => ({ files: ["/memory/fixture.parquet"], errors: [] }),
    load: async (_file, options) => {
      const sliced = options?.limit !== undefined ? samples.slice(0, options.limit) : samples
      return {
        samples: sliced,
        metadata: { totalRows: sliced.length, loadedRows: sliced.length, skippedRows: 0, errors: [] },
      }
    },
  }
}

function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    geminiApiKey: "test-key",
    model: "test-model",
    thinkingBudget: 0,
    concurrency: 2,
    dataPattern: "ignored",
    outputDir: tmp,
    ...overrides,
  }
}

/** Stub invoke that echoes the reference text back as a perfect transcription. */
function echoInvoke(failIds: Set<string> = new Set()) {
  const calls: string[] = []
  const invoke = async (_model: unknown, sample: Sample): Promise<AiResult> => {
    calls.push(sample.id)
    if (failIds.has(sample.id)) {
      return {
        sampleId: sample.id,
        success: false,
        error: "simulated failure",
        latencyMs: 1,
        tokenUsage: { input: 0, output: 0, total: 0 },
        modelVersion: "stub",
        rawResponse: null,
      }
    }
    return {
      sampleId: sample.id,
      success: true,
      latencyMs: 5,
      tokenUsage: { input: 10, output: 5, total: 15 },
      modelVersion: "stub",
      rawResponse: "{}",
      parsedResponse: makeGeminiOutput(sample.metadata.text as string),
    }
  }
  return { invoke, calls }
}

describe("runPipeline", () => {
  it("processes all samples and writes reports, summary, and checkpoint to the db", async () => {
    const { invoke, calls } = echoInvoke()
    const config = makeConfig({ resume: "test-run" })

    await runPipeline(config, makeMemorySource(makeSamples(3)), { invoke })

    expect(calls).toHaveLength(3)

    const db = openDb()
    expect(db.getSampleReports("test-run")).toHaveLength(3)

    const summary = db.getSummary("test-run")!
    expect(summary.totalSamples).toBe(3)
    expect(summary.successfulSamples).toBe(3)
    expect(summary.failedSamples).toBe(0)
    expect(summary.overall.avgWER).toBe(0)
    expect(summary.overall.totalTokens).toBe(45)

    const checkpoint = new CheckpointManager(db, "test-run").load()!
    expect(checkpoint.processedSampleIds).toHaveLength(3)
    expect(checkpoint.failedSampleIds).toHaveLength(0)

    const prom = await Bun.file(join(tmp, "test-run", "metrics.prom")).text()
    expect(prom).toContain("wer_samples_processed 3")
    expect(prom).toContain("wer_avg_wer 0.0000")
  })

  it("respects maxSamples", async () => {
    const { invoke, calls } = echoInvoke()
    const config = makeConfig({ resume: "limited-run", maxSamples: 2 })

    await runPipeline(config, makeMemorySource(makeSamples(5)), { invoke })

    expect(calls).toHaveLength(2)
    expect(openDb().getSummary("limited-run")!.totalSamples).toBe(2)
  })

  it("records failures without aborting below the circuit-breaker threshold", async () => {
    const { invoke } = echoInvoke(new Set(["gonder_row_0002"]))
    const config = makeConfig({ resume: "failure-run", concurrency: 1 })

    await runPipeline(config, makeMemorySource(makeSamples(10)), { invoke })

    const db = openDb()
    const summary = db.getSummary("failure-run")!
    expect(summary.totalSamples).toBe(10)
    expect(summary.successfulSamples).toBe(9)
    expect(summary.failedSamples).toBe(1)

    const checkpoint = new CheckpointManager(db, "failure-run").load()!
    expect(checkpoint.failedSampleIds).toEqual(["gonder_row_0002"])
    expect(checkpoint.processedSampleIds).toHaveLength(9)
  })

  it("trips the circuit breaker when too many samples fail", async () => {
    const allFail = new Set(Array.from({ length: 10 }, (_, i) => `gonder_row_${String(i).padStart(4, "0")}`))
    const { invoke } = echoInvoke(allFail)
    const config = makeConfig({ resume: "breaker-run", concurrency: 1 })

    let error: unknown
    try {
      await runPipeline(config, makeMemorySource(makeSamples(10)), { invoke })
    } catch (e) {
      error = e
    }

    expect(error).toBeDefined()
    const messages =
      error instanceof AggregateError
        ? error.errors.map((e) => String(e))
        : [String(error)]
    expect(messages.some((m) => m.includes("Circuit breaker"))).toBe(true)
  })

  it("skips already-processed samples on resume and keeps them in the summary", async () => {
    const first = echoInvoke()
    const config = makeConfig({ resume: "resume-run" })
    await runPipeline(config, makeMemorySource(makeSamples(3)), { invoke: first.invoke })

    // second run with the same runId must not re-invoke anything
    const second = echoInvoke()
    await runPipeline(config, makeMemorySource(makeSamples(3)), { invoke: second.invoke })

    expect(second.calls).toHaveLength(0)

    const summary = openDb().getSummary("resume-run")!
    expect(summary.totalSamples).toBe(3)
    expect(summary.successfulSamples).toBe(3)
  })

  it("writes JSON mirrors next to the database (samples/, summary.json, checkpoint.json)", async () => {
    const { invoke } = echoInvoke()
    await runPipeline(makeConfig({ resume: "json-run" }), makeMemorySource(makeSamples(2)), { invoke })

    const sampleJson = await Bun.file(join(tmp, "json-run", "samples", "gonder_row_0000.json")).json()
    expect(sampleJson.runId).toBe("json-run")
    expect(sampleJson.comparison.dimensions.text.wer).toBe(0)
    // persisted reports must never contain credentials
    expect(sampleJson.config.geminiApiKey).toBeUndefined()
    expect(sampleJson.config.model).toBe("test-model")

    const summaryJson = await Bun.file(join(tmp, "json-run", "summary.json")).json()
    expect(summaryJson.totalSamples).toBe(2)

    const checkpointJson = await Bun.file(join(tmp, "json-run", "checkpoint.json")).json()
    expect(checkpointJson.processedSampleIds).toHaveLength(2)
  })

  it("never re-tests a sample already evaluated with the same model + thinking setting", async () => {
    const first = echoInvoke()
    await runPipeline(makeConfig({ resume: "dedupe-a" }), makeMemorySource(makeSamples(3)), { invoke: first.invoke })
    expect(first.calls).toHaveLength(3)

    // brand-new run, same model + thinkingBudget → nothing to do
    const second = echoInvoke()
    await runPipeline(makeConfig({ resume: "dedupe-b" }), makeMemorySource(makeSamples(3)), { invoke: second.invoke })
    expect(second.calls).toHaveLength(0)

    // a different model is a different experiment → all samples run again
    const third = echoInvoke()
    await runPipeline(
      makeConfig({ resume: "dedupe-c", model: "other-model" }),
      makeMemorySource(makeSamples(3)),
      { invoke: third.invoke },
    )
    expect(third.calls).toHaveLength(3)

    // a different thinking budget too
    const fourth = echoInvoke()
    await runPipeline(
      makeConfig({ resume: "dedupe-d", thinkingBudget: 1024 }),
      makeMemorySource(makeSamples(3)),
      { invoke: fourth.invoke },
    )
    expect(fourth.calls).toHaveLength(3)
  })

  it("moves on to the next untested samples instead of re-testing the limit window", async () => {
    const first = echoInvoke()
    await runPipeline(
      makeConfig({ resume: "walk-a", maxSamples: 2 }),
      makeMemorySource(makeSamples(5)),
      { invoke: first.invoke },
    )
    expect(first.calls).toEqual(["gonder_row_0000", "gonder_row_0001"])

    // same model again: the limit applies to NEW samples, so the run advances
    const second = echoInvoke()
    await runPipeline(
      makeConfig({ resume: "walk-b", maxSamples: 2 }),
      makeMemorySource(makeSamples(5)),
      { invoke: second.invoke },
    )
    expect(second.calls).toEqual(["gonder_row_0002", "gonder_row_0003"])
  })

  it("re-tests everything when retest is set", async () => {
    const first = echoInvoke()
    await runPipeline(makeConfig({ resume: "force-a" }), makeMemorySource(makeSamples(2)), { invoke: first.invoke })

    const second = echoInvoke()
    await runPipeline(
      makeConfig({ resume: "force-b", retest: true }),
      makeMemorySource(makeSamples(2)),
      { invoke: second.invoke },
    )
    expect(second.calls).toHaveLength(2)
  })

  it("retries previously failed samples on resume", async () => {
    const first = echoInvoke(new Set(["gonder_row_0001"]))
    const config = makeConfig({ resume: "retry-run", concurrency: 1 })
    await runPipeline(config, makeMemorySource(makeSamples(3)), { invoke: first.invoke })

    const second = echoInvoke() // succeeds this time
    await runPipeline(config, makeMemorySource(makeSamples(3)), { invoke: second.invoke })

    expect(second.calls).toEqual(["gonder_row_0001"])

    const db = openDb()
    const checkpoint = new CheckpointManager(db, "retry-run").load()!
    expect(checkpoint.processedSampleIds).toHaveLength(3)
    expect(checkpoint.failedSampleIds).toHaveLength(0)

    const summary = db.getSummary("retry-run")!
    expect(summary.successfulSamples).toBe(3)
  })
})
