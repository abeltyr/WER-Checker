import { join } from "node:path"
import type { SampleReport, Sample, AiResult, Comparison, RunConfig } from "../core/types"
import { toReportSample } from "../core/types"
import { writeJson } from "../storage"
import type { ResultsDb } from "../storage/db"

/** Persist a sample report to both stores: SQLite (queryable) and JSON (browsable). */
export async function writeSampleReport(
  db: ResultsDb,
  outputDir: string,
  runId: string,
  config: RunConfig,
  sample: Sample,
  ai: AiResult,
  comparison: Comparison,
): Promise<SampleReport> {
  const report: SampleReport = {
    runId,
    timestamp: new Date().toISOString(),
    config,
    sample: toReportSample(sample),
    ai,
    comparison,
  }

  db.insertSampleReport(report)
  await writeJson(join(outputDir, runId, "samples", `${sample.id}.json`), report)
  return report
}
