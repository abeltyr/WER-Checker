import { join } from "node:path"
import type { SampleReport, SummaryReport, RunConfig, MetricSummary } from "../core/types"
import { writeJson } from "../storage"
import type { ResultsDb } from "../storage/db"

/** Persist the run summary to both stores: SQLite (queryable) and JSON (browsable). */
export async function writeSummaryReport(
  db: ResultsDb,
  outputDir: string,
  runId: string,
  config: RunConfig,
  reports: SampleReport[],
): Promise<SummaryReport> {
  const valid = reports.filter((r) => r.ai.success)
  const failed = reports.length - valid.length

  const summary: SummaryReport = {
    runId,
    timestamp: new Date().toISOString(),
    config,
    totalSamples: reports.length,
    successfulSamples: valid.length,
    failedSamples: failed,
    overall: aggregate(valid),
    byDialect: groupBy(valid, (r) => r.sample.dialect),
    byGender: groupBy(valid, (r) => String(r.sample.metadata.gender ?? "unknown")),
    byPredictedGender: groupBy(valid, (r) => r.comparison.dimensions.gender.predicted),
    byGenderMatch: groupBy(valid, (r) => String(r.comparison.dimensions.gender.match)),
    byDialectMatch: groupBy(valid, (r) => String(r.comparison.dimensions.dialect.match)),
    sampleIds: reports.map((r) => r.sample.id),
  }

  db.saveSummary(summary)
  await writeJson(join(outputDir, runId, "summary.json"), summary)
  return summary
}

function aggregate(reports: SampleReport[]): MetricSummary {
  if (reports.length === 0) {
    return {
      count: 0, avgWER: 0, minWER: 0, maxWER: 0, avgCER: 0,
      avgMER: 0, avgWIL: 0, avgBLEU: 0,
      avgLatencyMs: 0, totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0,
      avgTokens: 0, totalCostUsd: 0, avgCostUsd: 0,
    }
  }

  let totalWER = 0
  let totalCER = 0
  let totalMER = 0
  let totalWIL = 0
  let totalBLEU = 0
  let totalLatency = 0
  let totalTokens = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCostUsd = 0
  let minWER = Infinity
  let maxWER = -Infinity
  let genderMatches = 0
  let dialectMatches = 0

  for (const r of reports) {
    const text = r.comparison.dimensions.text
    totalWER += text.wer
    totalCER += text.cer
    totalMER += text.mer
    totalWIL += text.wil
    totalBLEU += text.bleu
    totalLatency += r.ai.latencyMs
    totalTokens += r.ai.tokenUsage.total
    totalInputTokens += r.ai.tokenUsage.input
    totalOutputTokens += r.ai.tokenUsage.output
    totalCostUsd += r.ai.costUsd ?? 0
    if (text.wer < minWER) minWER = text.wer
    if (text.wer > maxWER) maxWER = text.wer
    if (r.comparison.dimensions.gender.match) genderMatches++
    if (r.comparison.dimensions.dialect.match) dialectMatches++
  }

  const n = reports.length
  return {
    count: n,
    avgWER: +(totalWER / n).toFixed(4),
    minWER: +(minWER).toFixed(4),
    maxWER: +(maxWER).toFixed(4),
    avgCER: +(totalCER / n).toFixed(4),
    avgMER: +(totalMER / n).toFixed(4),
    avgWIL: +(totalWIL / n).toFixed(4),
    avgBLEU: +(totalBLEU / n).toFixed(4),
    avgLatencyMs: Math.round(totalLatency / n),
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    avgTokens: Math.round(totalTokens / n),
    totalCostUsd: +totalCostUsd.toFixed(6),
    avgCostUsd: +(totalCostUsd / n).toFixed(6),
    genderMatchRate: +(genderMatches / n).toFixed(4),
    dialectMatchRate: +(dialectMatches / n).toFixed(4),
  }
}

function groupBy(
  reports: SampleReport[],
  keyFn: (r: SampleReport) => string,
): Record<string, MetricSummary> {
  const groups: Record<string, SampleReport[]> = {}
  for (const r of reports) {
    const key = keyFn(r)
    if (!groups[key]) groups[key] = []
    groups[key]!.push(r)
  }

  const result: Record<string, MetricSummary> = {}
  for (const [key, items] of Object.entries(groups)) {
    result[key] = aggregate(items)
  }
  return result
}
