import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import type { SampleReport, SummaryReport } from "../core/types"

export interface CheckpointRow {
  runId: string
  timestamp: string
  totalSamples: number
  lastProcessedIndex: number
}

export interface CheckpointSampleRow {
  sampleId: string
  success: boolean
}

interface ModelComparisonRaw {
  model: string | null
  thinking_budget: number | null
  samples: number
  successful: number | null
  avg_wer: number | null
  avg_cer: number | null
  avg_latency_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  cost_usd: number | null
}

export interface ModelComparisonRow {
  model: string
  thinkingBudget: number
  samples: number
  successful: number
  avgWer: number | null
  avgCer: number | null
  avgLatencyMs: number | null
  inputTokens: number
  outputTokens: number
  costUsd: number | null
}

export interface SampleCrossCheckRow {
  model: string
  thinkingBudget: number
  success: boolean
  wer: number
  cer: number
  costUsd: number | undefined
  latencyMs: number
  referenceText: string
  hypothesisText: string
}

/**
 * Single SQLite database holding everything a run persists: checkpoint state,
 * per-sample reports, and run summaries — all keyed by run_id so one file
 * covers every run in an output directory.
 *
 * Queryable fields (wer, gender, latency, …) are extracted into columns; the
 * complete report/summary objects are stored as JSON alongside them, so no
 * data that the JSON files used to hold is lost.
 */
export class ResultsDb {
  private db: Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true })
    // WAL keeps concurrent sample writes from blocking on each other
    this.db.run("PRAGMA journal_mode = WAL")
    this.migrate()
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        run_id               TEXT PRIMARY KEY,
        timestamp            TEXT NOT NULL,
        total_samples        INTEGER NOT NULL,
        last_processed_index INTEGER NOT NULL
      )
    `)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS checkpoint_samples (
        run_id     TEXT NOT NULL,
        sample_id  TEXT NOT NULL,
        success    INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (run_id, sample_id)
      )
    `)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sample_reports (
        run_id          TEXT NOT NULL,
        sample_id       TEXT NOT NULL,
        timestamp       TEXT NOT NULL,
        success         INTEGER NOT NULL,
        model           TEXT,
        thinking_budget INTEGER,
        dialect         TEXT,
        gender          TEXT,
        wer             REAL,
        cer             REAL,
        latency_ms      INTEGER,
        input_tokens    INTEGER,
        output_tokens   INTEGER,
        total_tokens    INTEGER,
        cost_usd        REAL,
        report          TEXT NOT NULL,
        PRIMARY KEY (run_id, sample_id)
      )
    `)
    // Databases created before later columns existed: add them and backfill
    // what the stored report JSON already knows.
    const columns = this.db
      .query<{ name: string }, []>("PRAGMA table_info(sample_reports)")
      .all()
      .map((c) => c.name)
    if (!columns.includes("model")) {
      this.db.run("ALTER TABLE sample_reports ADD COLUMN model TEXT")
      this.db.run("ALTER TABLE sample_reports ADD COLUMN thinking_budget INTEGER")
      this.db.run(`
        UPDATE sample_reports SET
          model = json_extract(report, '$.config.model'),
          thinking_budget = json_extract(report, '$.config.thinkingBudget')
        WHERE model IS NULL
      `)
    }
    if (!columns.includes("input_tokens")) {
      this.db.run("ALTER TABLE sample_reports ADD COLUMN input_tokens INTEGER")
      this.db.run("ALTER TABLE sample_reports ADD COLUMN output_tokens INTEGER")
      this.db.run("ALTER TABLE sample_reports ADD COLUMN cost_usd REAL")
      this.db.run(`
        UPDATE sample_reports SET
          input_tokens = json_extract(report, '$.ai.tokenUsage.input'),
          output_tokens = json_extract(report, '$.ai.tokenUsage.output'),
          cost_usd = json_extract(report, '$.ai.costUsd')
        WHERE input_tokens IS NULL
      `)
    }
    this.db.run(`
      CREATE TABLE IF NOT EXISTS summaries (
        run_id    TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        summary   TEXT NOT NULL
      )
    `)
  }

  // ── checkpoints ────────────────────────────────────────────────────────────

  upsertCheckpoint(row: CheckpointRow): void {
    this.db
      .query(`
        INSERT INTO checkpoints (run_id, timestamp, total_samples, last_processed_index)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(run_id) DO UPDATE SET
          timestamp = ?2, total_samples = ?3, last_processed_index = ?4
      `)
      .run(row.runId, row.timestamp, row.totalSamples, row.lastProcessedIndex)
  }

  getCheckpoint(runId: string): CheckpointRow | null {
    const row = this.db
      .query<{ run_id: string; timestamp: string; total_samples: number; last_processed_index: number }, [string]>(
        "SELECT * FROM checkpoints WHERE run_id = ?1",
      )
      .get(runId)
    if (!row) return null
    return {
      runId: row.run_id,
      timestamp: row.timestamp,
      totalSamples: row.total_samples,
      lastProcessedIndex: row.last_processed_index,
    }
  }

  markCheckpointSample(runId: string, sampleId: string, success: boolean): void {
    this.db
      .query(`
        INSERT INTO checkpoint_samples (run_id, sample_id, success, updated_at)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(run_id, sample_id) DO UPDATE SET success = ?3, updated_at = ?4
      `)
      .run(runId, sampleId, success ? 1 : 0, new Date().toISOString())
  }

  getCheckpointSamples(runId: string): CheckpointSampleRow[] {
    return this.db
      .query<{ sample_id: string; success: number }, [string]>(
        "SELECT sample_id, success FROM checkpoint_samples WHERE run_id = ?1 ORDER BY updated_at",
      )
      .all(runId)
      .map((r) => ({ sampleId: r.sample_id, success: r.success === 1 }))
  }

  deleteCheckpoint(runId: string): void {
    this.db.query("DELETE FROM checkpoint_samples WHERE run_id = ?1").run(runId)
    this.db.query("DELETE FROM checkpoints WHERE run_id = ?1").run(runId)
  }

  // ── sample reports ─────────────────────────────────────────────────────────

  insertSampleReport(report: SampleReport): void {
    const text = report.comparison.dimensions.text
    this.db
      .query(`
        INSERT INTO sample_reports
          (run_id, sample_id, timestamp, success, model, thinking_budget,
           dialect, gender, wer, cer, latency_ms,
           input_tokens, output_tokens, total_tokens, cost_usd, report)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
        ON CONFLICT(run_id, sample_id) DO UPDATE SET
          timestamp = ?3, success = ?4, model = ?5, thinking_budget = ?6,
          dialect = ?7, gender = ?8, wer = ?9, cer = ?10, latency_ms = ?11,
          input_tokens = ?12, output_tokens = ?13, total_tokens = ?14,
          cost_usd = ?15, report = ?16
      `)
      .run(
        report.runId,
        report.sample.id,
        report.timestamp,
        report.ai.success ? 1 : 0,
        report.config.model,
        report.config.thinkingBudget,
        report.sample.dialect,
        String(report.sample.metadata.gender ?? "unknown"),
        text.wer,
        text.cer,
        report.ai.latencyMs,
        report.ai.tokenUsage.input,
        report.ai.tokenUsage.output,
        report.ai.tokenUsage.total,
        report.ai.costUsd ?? null,
        JSON.stringify(report),
      )
  }

  /**
   * Sample ids that already have a successful result for this exact
   * model + thinking-budget combination, across every run in the database.
   * Failed attempts don't count — those should be retried.
   */
  getTestedSampleIds(model: string, thinkingBudget: number): Set<string> {
    const rows = this.db
      .query<{ sample_id: string }, [string, number]>(
        `SELECT DISTINCT sample_id FROM sample_reports
         WHERE model = ?1 AND thinking_budget = ?2 AND success = 1`,
      )
      .all(model, thinkingBudget)
    return new Set(rows.map((r) => r.sample_id))
  }

  getSampleReports(runId: string): SampleReport[] {
    return this.db
      .query<{ report: string }, [string]>(
        "SELECT report FROM sample_reports WHERE run_id = ?1 ORDER BY sample_id",
      )
      .all(runId)
      .map((r) => JSON.parse(r.report) as SampleReport)
  }

  // ── cross-model comparison ─────────────────────────────────────────────────

  /**
   * Aggregate results per model + thinking-budget across all runs.
   * When a sample was tested multiple times by the same combination, only
   * its most recent attempt counts, so old duplicate runs don't skew rates.
   */
  getModelComparison(): ModelComparisonRow[] {
    return this.db
      .query<ModelComparisonRaw, []>(`
        WITH latest AS (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY model, thinking_budget, sample_id
            ORDER BY timestamp DESC
          ) AS rn
          FROM sample_reports
        )
        SELECT
          model,
          thinking_budget,
          COUNT(*)                                          AS samples,
          SUM(success)                                      AS successful,
          AVG(CASE WHEN success = 1 THEN wer END)           AS avg_wer,
          AVG(CASE WHEN success = 1 THEN cer END)           AS avg_cer,
          AVG(CASE WHEN success = 1 THEN latency_ms END)    AS avg_latency_ms,
          SUM(input_tokens)                                 AS input_tokens,
          SUM(output_tokens)                                AS output_tokens,
          SUM(cost_usd)                                     AS cost_usd
        FROM latest
        WHERE rn = 1
        GROUP BY model, thinking_budget
        ORDER BY avg_wer ASC NULLS LAST
      `)
      .all()
      .map((r) => ({
        model: r.model ?? "unknown",
        thinkingBudget: r.thinking_budget ?? 0,
        samples: r.samples,
        successful: r.successful ?? 0,
        avgWer: r.avg_wer,
        avgCer: r.avg_cer,
        avgLatencyMs: r.avg_latency_ms,
        inputTokens: r.input_tokens ?? 0,
        outputTokens: r.output_tokens ?? 0,
        costUsd: r.cost_usd,
      }))
  }

  /**
   * Every model's most recent take on one sample — reference vs hypothesis
   * side by side, for cross-checking transcriptions.
   */
  getSampleCrossCheck(sampleId: string): SampleCrossCheckRow[] {
    return this.db
      .query<{ model: string | null; thinking_budget: number | null; report: string }, [string]>(`
        WITH latest AS (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY model, thinking_budget
            ORDER BY timestamp DESC
          ) AS rn
          FROM sample_reports
          WHERE sample_id = ?1
        )
        SELECT model, thinking_budget, report FROM latest WHERE rn = 1
        ORDER BY model
      `)
      .all(sampleId)
      .map((r) => {
        const report = JSON.parse(r.report) as SampleReport
        const text = report.comparison.dimensions.text
        return {
          model: r.model ?? "unknown",
          thinkingBudget: r.thinking_budget ?? 0,
          success: report.ai.success,
          wer: text.wer,
          cer: text.cer,
          costUsd: report.ai.costUsd,
          latencyMs: report.ai.latencyMs,
          referenceText: text.referenceText,
          hypothesisText: text.hypothesisText,
        }
      })
  }

  // ── summaries ──────────────────────────────────────────────────────────────

  saveSummary(summary: SummaryReport): void {
    this.db
      .query(`
        INSERT INTO summaries (run_id, timestamp, summary)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(run_id) DO UPDATE SET timestamp = ?2, summary = ?3
      `)
      .run(summary.runId, summary.timestamp, JSON.stringify(summary))
  }

  getSummary(runId: string): SummaryReport | null {
    const row = this.db
      .query<{ summary: string }, [string]>("SELECT summary FROM summaries WHERE run_id = ?1")
      .get(runId)
    return row ? (JSON.parse(row.summary) as SummaryReport) : null
  }

  close(): void {
    this.db.close()
  }
}

/** Open (creating if needed) the results database for an output directory. */
export function openResultsDb(outputDir: string): ResultsDb {
  mkdirSync(outputDir, { recursive: true })
  return new ResultsDb(join(outputDir, "results.db"))
}
