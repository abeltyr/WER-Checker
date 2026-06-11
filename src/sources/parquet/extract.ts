import { basename, dirname } from "node:path"
import { decodeWavBytes } from "./audio"
import type { Sample } from "../../core/types"
import type { LoadOptions } from "../types"
import duckdb from "duckdb-async"

export async function extractParquetSamples(
  filePath: string,
  options?: LoadOptions
): Promise<Sample[]> {
  const db = await duckdb.Database.create(":memory:")
  try {
    return await extractWithDb(db, filePath, options)
  } finally {
    await db.close()
  }
}

async function extractWithDb(
  db: Awaited<ReturnType<typeof duckdb.Database.create>>,
  filePath: string,
  options?: LoadOptions
): Promise<Sample[]> {
  const dialect = inferDialect(filePath)

  const limitClause = options?.limit
    ? `LIMIT ${Math.floor(options.limit)}`
    : ""
  const offsetClause = options?.offset
    ? `OFFSET ${Math.floor(options.offset)}`
    : ""

  const result = await db.all(`
    SELECT
      text,
      audio.bytes as audio_bytes,
      dialect,
      speaker_id,
      gender
    FROM read_parquet('${escapeSqlString(filePath)}')
    ${limitClause}
    ${offsetClause}
  `)

  const samples: Sample[] = []
  let rowIndex = options?.offset ?? 0

  for (const row of result) {
    const audioBytes = row.audio_bytes
    if (!audioBytes) {
      rowIndex++
      continue
    }

    let buf: Buffer
    if (audioBytes instanceof ArrayBuffer) {
      buf = Buffer.from(audioBytes)
    } else if (ArrayBuffer.isView(audioBytes)) {
      buf = Buffer.from(audioBytes.buffer, audioBytes.byteOffset, audioBytes.byteLength)
    } else if (Buffer.isBuffer(audioBytes)) {
      buf = audioBytes
    } else {
      buf = Buffer.from(audioBytes)
    }

    const decoded = decodeWavBytes(buf)
    if (!decoded) {
      rowIndex++
      continue
    }

    const sample: Sample = {
      id: `${dialect}_row_${String(rowIndex).padStart(4, "0")}`,
      source: "parquet",
      sourceFile: filePath,
      rowIndex,
      dialect: (row.dialect as string) ?? dialect,
      audioBuffer: buf,
      audioMimeType: "audio/wav",
      durationSeconds: decoded.durationSeconds,
      sampleRate: decoded.sampleRate,
      metadata: {
        text: row.text as string | undefined,
        dialect: row.dialect as string | undefined,
        speaker_id: row.speaker_id as string | undefined,
        gender: row.gender as string | undefined,
      },
    }

    if (options?.filter && !options.filter(sample)) {
      rowIndex++
      continue
    }

    samples.push(sample)
    rowIndex++
  }

  return samples
}

function inferDialect(filePath: string): string {
  return basename(dirname(filePath))
}

export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''")
}
