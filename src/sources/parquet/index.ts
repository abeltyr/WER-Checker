import type { DataSource, DiscoveryResult, LoadResult, LoadOptions, ValidationResult } from "../types"
import { discoverParquetFiles } from "./discover"
import { extractParquetSamples, escapeSqlString } from "./extract"
import duckdb from "duckdb-async"

export const parquetSource: DataSource = {
  name: "parquet",
  version: "2.0.0",
  capabilities: {
    streaming: false,
    batching: true,
    filtering: false,
    validation: true,
  },

  discover: async (pattern: string): Promise<DiscoveryResult> => {
    const files = await discoverParquetFiles(pattern)
    const errors: Array<{ path: string; reason: string }> = []
    
    return { files, errors }
  },

  load: async (filePath: string, options?: LoadOptions): Promise<LoadResult> => {
    const samples = await extractParquetSamples(filePath, options)
    
    return {
      samples,
      metadata: {
        totalRows: samples.length,
        loadedRows: samples.length,
        skippedRows: 0,
        errors: [],
      },
    }
  },

  validate: async (filePath: string): Promise<ValidationResult> => {
    try {
      const db = await duckdb.Database.create(":memory:")
      let result: Array<Record<string, unknown>>
      try {
        result = await db.all(`
          SELECT column_name
          FROM (DESCRIBE SELECT * FROM read_parquet('${escapeSqlString(filePath)}'))
        `)
      } finally {
        await db.close()
      }

      const requiredColumns = ["text", "audio", "dialect"]
      const presentColumns = result.map((r: any) => r.column_name)
      const missingColumns = requiredColumns.filter(col => !presentColumns.includes(col))

      return {
        valid: missingColumns.length === 0,
        missingColumns,
        errors: missingColumns.length > 0 
          ? [`Missing required columns: ${missingColumns.join(", ")}`]
          : [],
      }
    } catch (err) {
      return {
        valid: false,
        missingColumns: [],
        errors: [err instanceof Error ? err.message : String(err)],
      }
    }
  },
}
