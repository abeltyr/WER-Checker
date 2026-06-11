import type { Sample } from "../core/types"

export interface DiscoveryResult {
  files: string[]
  errors: Array<{ path: string; reason: string }>
}

export interface LoadResult {
  samples: Sample[]
  metadata: {
    totalRows: number
    loadedRows: number
    skippedRows: number
    errors: Array<{ row: number; reason: string }>
  }
}

export interface LoadOptions {
  limit?: number
  offset?: number
  filter?: (sample: Sample) => boolean
}

export interface ValidationResult {
  valid: boolean
  missingColumns: string[]
  errors: string[]
}

export interface DataSourceCapabilities {
  streaming: boolean
  batching: boolean
  filtering: boolean
  validation: boolean
}

export interface DataSource {
  readonly name: string
  readonly version: string
  readonly capabilities: DataSourceCapabilities

  discover(pattern: string): Promise<DiscoveryResult>
  load(filePath: string, options?: LoadOptions): Promise<LoadResult>
  validate?(filePath: string): Promise<ValidationResult>
}
