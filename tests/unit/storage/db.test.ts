import { describe, it, expect, beforeEach, afterAll } from "bun:test"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { openResultsDb, ResultsDb } from "../../../src/storage/db"
import { compareAll } from "../../../src/analysis"
import { toReportSample } from "../../../src/core/types"
import type { SampleReport, SummaryReport } from "../../../src/core/types"
import { makeTmpDir, makeSample, makeAiResult, makeRunConfig } from "../../helpers"

let tmp: string
let db: ResultsDb
const tmpDirs: string[] = []
const dbs: ResultsDb[] = []

beforeEach(async () => {
  tmp = await makeTmpDir("wer-db-")
  tmpDirs.push(tmp)
  db = openResultsDb(tmp)
  dbs.push(db)
})

afterAll(async () => {
  for (const d of dbs) d.close()
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })))
})

function makeFullReport(runId: string, sampleId: string): SampleReport {
  const sample = makeSample({ id: sampleId })
  const ai = makeAiResult({ sampleId })
  return {
    runId,
    timestamp: new Date().toISOString(),
    config: makeRunConfig(),
    sample: toReportSample(sample),
    ai,
    comparison: compareAll(sample, ai),
  }
}

describe("ResultsDb", () => {
  it("creates the database file inside the output directory", async () => {
    expect(await Bun.file(join(tmp, "results.db")).exists()).toBe(true)
  })

  it("round-trips a sample report byte-for-byte", () => {
    const report = makeFullReport("run1", "s1")
    db.insertSampleReport(report)

    expect(db.getSampleReports("run1")).toEqual([report])
    expect(db.getSampleReports("other-run")).toEqual([])
  })

  it("round-trips checkpoint rows and per-sample progress", () => {
    db.upsertCheckpoint({ runId: "run1", timestamp: "t1", totalSamples: 5, lastProcessedIndex: 2 })
    db.markCheckpointSample("run1", "s1", true)
    db.markCheckpointSample("run1", "s2", false)
    db.markCheckpointSample("run1", "s2", true) // upsert flips failure to success

    expect(db.getCheckpoint("run1")).toEqual({
      runId: "run1",
      timestamp: "t1",
      totalSamples: 5,
      lastProcessedIndex: 2,
    })
    expect(db.getCheckpointSamples("run1")).toEqual([
      { sampleId: "s1", success: true },
      { sampleId: "s2", success: true },
    ])
    expect(db.getCheckpoint("missing")).toBeNull()
  })

  it("deleteCheckpoint removes the run's checkpoint state only", () => {
    db.upsertCheckpoint({ runId: "run1", timestamp: "t", totalSamples: 1, lastProcessedIndex: 0 })
    db.markCheckpointSample("run1", "s1", true)
    db.upsertCheckpoint({ runId: "run2", timestamp: "t", totalSamples: 1, lastProcessedIndex: 0 })

    db.deleteCheckpoint("run1")

    expect(db.getCheckpoint("run1")).toBeNull()
    expect(db.getCheckpointSamples("run1")).toEqual([])
    expect(db.getCheckpoint("run2")).not.toBeNull()
  })

  it("round-trips a summary", () => {
    const summary: SummaryReport = {
      runId: "run1",
      timestamp: new Date().toISOString(),
      config: makeRunConfig(),
      totalSamples: 1,
      successfulSamples: 1,
      failedSamples: 0,
      overall: {
        count: 1, avgWER: 0, minWER: 0, maxWER: 0, avgCER: 0, avgMER: 0,
        avgWIL: 0, avgBLEU: 1, avgLatencyMs: 5, totalTokens: 15,
        totalInputTokens: 10, totalOutputTokens: 5, avgTokens: 15,
        totalCostUsd: 0, avgCostUsd: 0,
      },
      byDialect: {},
      byGender: {},
      byPredictedGender: {},
      byGenderMatch: {},
      byDialectMatch: {},
      sampleIds: ["s1"],
    }

    db.saveSummary(summary)
    expect(db.getSummary("run1")).toEqual(summary)
    expect(db.getSummary("missing")).toBeNull()
  })

  it("tracks tested samples per model + thinking-budget combination", () => {
    const ok = makeFullReport("run1", "s1") // success, model "test-model", thinking 0
    db.insertSampleReport(ok)

    const failed = makeFullReport("run1", "s2")
    failed.ai = { ...failed.ai, success: false }
    db.insertSampleReport(failed)

    const otherModel = makeFullReport("run2", "s3")
    otherModel.config = { ...otherModel.config, model: "other-model" }
    db.insertSampleReport(otherModel)

    const tested = db.getTestedSampleIds("test-model", 0)
    expect(tested).toEqual(new Set(["s1"])) // failures and other models excluded
    expect(db.getTestedSampleIds("other-model", 0)).toEqual(new Set(["s3"]))
    expect(db.getTestedSampleIds("test-model", 512)).toEqual(new Set())
  })

  it("aggregates a cross-model comparison from the latest attempt per sample", () => {
    // model A: s1 tested twice — old failure superseded by a success
    const oldFail = makeFullReport("run1", "s1")
    oldFail.timestamp = "2026-01-01T00:00:00Z"
    oldFail.ai = { ...oldFail.ai, success: false }
    db.insertSampleReport(oldFail)

    const newOk = makeFullReport("run2", "s1")
    newOk.timestamp = "2026-01-02T00:00:00Z"
    db.insertSampleReport(newOk)

    // model B: one sample with cost
    const other = makeFullReport("run3", "s1")
    other.config = { ...other.config, model: "other-model" }
    other.ai = { ...other.ai, costUsd: 0.5 }
    db.insertSampleReport(other)

    const rows = db.getModelComparison()
    expect(rows).toHaveLength(2)

    const a = rows.find((r) => r.model === "test-model")!
    expect(a.samples).toBe(1) // latest attempt only, not both runs
    expect(a.successful).toBe(1)
    expect(a.avgWer).toBe(0)
    expect(a.inputTokens).toBe(10)
    expect(a.outputTokens).toBe(5)

    const b = rows.find((r) => r.model === "other-model")!
    expect(b.costUsd).toBeCloseTo(0.5, 6)
  })

  it("cross-checks one sample across models", () => {
    db.insertSampleReport(makeFullReport("run1", "s1"))
    const other = makeFullReport("run2", "s1")
    other.config = { ...other.config, model: "other-model" }
    db.insertSampleReport(other)

    const rows = db.getSampleCrossCheck("s1")
    expect(rows.map((r) => r.model).sort()).toEqual(["other-model", "test-model"])
    expect(rows[0]!.referenceText).toBe("ሰላም አለም")
    expect(rows[0]!.hypothesisText).toBe("ሰላም አለም")
    expect(db.getSampleCrossCheck("missing")).toEqual([])
  })

  it("persists across connections", () => {
    db.insertSampleReport(makeFullReport("run1", "s1"))

    const reopened = openResultsDb(tmp)
    dbs.push(reopened)
    expect(reopened.getSampleReports("run1")).toHaveLength(1)
  })
})
