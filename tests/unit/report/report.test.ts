import { describe, it, expect, beforeEach, afterAll } from "bun:test"
import { rm } from "node:fs/promises"
import { writeSampleReport } from "../../../src/report/sample"
import { writeSummaryReport } from "../../../src/report/summary"
import { compareAll } from "../../../src/analysis"
import { openResultsDb, ResultsDb } from "../../../src/storage/db"
import { readJson } from "../../../src/storage"
import { join } from "node:path"
import { toReportSample } from "../../../src/core/types"
import type { SampleReport } from "../../../src/core/types"
import { makeTmpDir, makeSample, makeAiResult, makeGeminiOutput, makeRunConfig } from "../../helpers"

let tmp: string
let db: ResultsDb
const tmpDirs: string[] = []
const dbs: ResultsDb[] = []

beforeEach(async () => {
  tmp = await makeTmpDir("wer-report-")
  tmpDirs.push(tmp)
  db = openResultsDb(tmp)
  dbs.push(db)
})

afterAll(async () => {
  for (const d of dbs) d.close()
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })))
})

const config = makeRunConfig()

function makeReport(opts: {
  id: string
  refText: string
  hypText?: string
  dialect?: string
  gender?: string
  success?: boolean
  latencyMs?: number
  tokens?: number
}): SampleReport {
  const sample = makeSample({
    id: opts.id,
    dialect: opts.dialect ?? "gonder",
    metadata: {
      text: opts.refText,
      dialect: opts.dialect ?? "gonder",
      gender: opts.gender ?? "female",
      speaker_id: "SPK1",
    },
  })
  const ai = makeAiResult({
    sampleId: opts.id,
    success: opts.success ?? true,
    latencyMs: opts.latencyMs ?? 100,
    tokenUsage: { input: 0, output: 0, total: opts.tokens ?? 10 },
    parsedResponse: opts.success === false ? undefined : makeGeminiOutput(opts.hypText ?? opts.refText),
  })
  return {
    runId: "test-run",
    timestamp: new Date().toISOString(),
    config,
    sample: toReportSample(sample),
    ai,
    comparison: compareAll(sample, ai),
  }
}

describe("writeSampleReport", () => {
  it("stores the full report in the database without the raw audio buffer", async () => {
    const sample = makeSample()
    const ai = makeAiResult()
    const comparison = compareAll(sample, ai)

    await writeSampleReport(db, tmp, "run1", config, sample, ai, comparison)

    const reports = db.getSampleReports("run1")
    expect(reports).toHaveLength(1)
    const report = reports[0]!
    expect(report.runId).toBe("run1")
    expect(report.sample.id).toBe(sample.id)
    expect((report.sample as any).audioBuffer).toBeUndefined()
    expect(report.sample.audioBytes).toBe(sample.audioBuffer.length)
    expect(report.comparison.dimensions.text.wer).toBe(0)
    // everything saved before is still saved: config, ai telemetry, comparison
    expect(report.config).toEqual(config)
    expect(report.ai.tokenUsage.total).toBe(15)
    expect(report.comparison.dimensions.gender.match).toBe(true)
  })

  it("writes the same report as a JSON file alongside the database", async () => {
    const sample = makeSample()
    const ai = makeAiResult()

    await writeSampleReport(db, tmp, "run1", config, sample, ai, compareAll(sample, ai))

    const fromFile = await readJson<SampleReport>(join(tmp, "run1", "samples", `${sample.id}.json`))
    expect(fromFile).toEqual(db.getSampleReports("run1")[0]!)
  })

  it("upserts on re-run of the same sample instead of duplicating", async () => {
    const sample = makeSample()
    const ai = makeAiResult()
    const comparison = compareAll(sample, ai)

    await writeSampleReport(db, tmp, "run1", config, sample, ai, comparison)
    await writeSampleReport(db, tmp, "run1", config, sample, ai, comparison)

    expect(db.getSampleReports("run1")).toHaveLength(1)
  })
})

describe("writeSummaryReport", () => {
  it("aggregates metrics across successful samples only", async () => {
    const reports = [
      makeReport({ id: "s1", refText: "ሰላም አለም" }), // wer 0
      makeReport({ id: "s2", refText: "ሀ ለ", hypText: "ሀ መ" }), // wer 0.5
      makeReport({ id: "s3", refText: "ሰላም", success: false }), // failed — excluded from averages
    ]

    await writeSummaryReport(db, tmp, "run1", config, reports)
    const summary = db.getSummary("run1")!

    expect(summary.totalSamples).toBe(3)
    expect(summary.successfulSamples).toBe(2)
    expect(summary.failedSamples).toBe(1)
    expect(summary.overall.count).toBe(2)
    expect(summary.overall.avgWER).toBeCloseTo(0.25, 4)
    expect(summary.overall.minWER).toBe(0)
    expect(summary.overall.maxWER).toBeCloseTo(0.5, 4)
    expect(summary.sampleIds).toEqual(["s1", "s2", "s3"])
  })

  it("groups by dialect and gender", async () => {
    const reports = [
      makeReport({ id: "s1", refText: "ሰላም", dialect: "gonder", gender: "female" }),
      makeReport({ id: "s2", refText: "ሰላም", dialect: "wollo", gender: "male" }),
      makeReport({ id: "s3", refText: "ሰላም", dialect: "wollo", gender: "male" }),
    ]

    await writeSummaryReport(db, tmp, "run1", config, reports)
    const summary = db.getSummary("run1")!

    expect(summary.byDialect.gonder!.count).toBe(1)
    expect(summary.byDialect.wollo!.count).toBe(2)
    expect(summary.byGender.female!.count).toBe(1)
    expect(summary.byGender.male!.count).toBe(2)
  })

  it("breaks down gender match rates", async () => {
    const matching = makeReport({ id: "s1", refText: "ሰላም", gender: "female" }) // predicted female
    const mismatching = makeReport({ id: "s2", refText: "ሰላም", gender: "male" }) // predicted female

    await writeSummaryReport(db, tmp, "run1", config, [matching, mismatching])
    const summary = db.getSummary("run1")!

    expect(summary.byGenderMatch.true!.count).toBe(1)
    expect(summary.byGenderMatch.false!.count).toBe(1)
    expect(summary.overall.genderMatchRate).toBeCloseTo(0.5, 4)
  })

  it("handles an all-failed run without dividing by zero", async () => {
    const reports = [makeReport({ id: "s1", refText: "ሰላም", success: false })]

    await writeSummaryReport(db, tmp, "run1", config, reports)
    const summary = db.getSummary("run1")!

    expect(summary.successfulSamples).toBe(0)
    expect(summary.overall.count).toBe(0)
    expect(summary.overall.avgWER).toBe(0)
  })
})
