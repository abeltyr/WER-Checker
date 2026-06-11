import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import duckdb from "duckdb-async"
import { extractParquetSamples } from "../../../../src/sources/parquet/extract"
import { parquetSource } from "../../../../src/sources/parquet"
import { makeTmpDir, makeWav } from "../../../helpers"

let tmp: string
let fixturePath: string
let noDialectPath: string

/**
 * Generates a small parquet fixture matching the Hugging-Face layout:
 * text VARCHAR, audio STRUCT(bytes BLOB, path VARCHAR), dialect, speaker_id, gender.
 * Rows: 2 valid WAVs, 1 NULL audio, 1 non-RIFF blob (the last two must be skipped).
 */
beforeAll(async () => {
  tmp = await makeTmpDir("wer-parquet-")
  await mkdir(join(tmp, "gonder"), { recursive: true })
  fixturePath = join(tmp, "gonder", "train-fixture.parquet")
  noDialectPath = join(tmp, "no-dialect.parquet")

  const wav1 = makeWav({ sampleRate: 8000, bitsPerSample: 16, numSamples: 8000 }).toString("hex")
  const wav2 = makeWav({ sampleRate: 16000, bitsPerSample: 16, numSamples: 8000 }).toString("hex")

  const db = await duckdb.Database.create(":memory:")
  await db.run(`
    COPY (
      SELECT 'ሰላም አለም' AS text, struct_pack(bytes := unhex('${wav1}'), path := 'r0.wav') AS audio,
             'gonder' AS dialect, 'SPK1' AS speaker_id, 'female' AS gender
      UNION ALL
      SELECT 'እንዴት ነህ', struct_pack(bytes := unhex('${wav2}'), path := 'r1.wav'),
             'gonder', 'SPK2', 'male'
      UNION ALL
      SELECT 'ባዶ ድምፅ', CAST(NULL AS STRUCT(bytes BLOB, path VARCHAR)),
             'gonder', 'SPK3', 'female'
      UNION ALL
      SELECT 'መጥፎ ድምፅ', struct_pack(bytes := unhex('41414141'), path := 'r3.wav'),
             'gonder', 'SPK4', 'male'
    ) TO '${fixturePath}' (FORMAT PARQUET)
  `)
  await db.run(`
    COPY (
      SELECT 'x' AS text, struct_pack(bytes := unhex('${wav1}'), path := 'r0.wav') AS audio
    ) TO '${noDialectPath}' (FORMAT PARQUET)
  `)
  await db.close()
})

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe("extractParquetSamples", () => {
  it("extracts valid rows and skips NULL or non-WAV audio", async () => {
    const samples = await extractParquetSamples(fixturePath)

    expect(samples).toHaveLength(2)
    expect(samples[0]!.id).toBe("gonder_row_0000")
    expect(samples[1]!.id).toBe("gonder_row_0001")
    expect(samples[0]!.metadata.text).toBe("ሰላም አለም")
    expect(samples[0]!.metadata.gender).toBe("female")
    expect(samples[0]!.metadata.speaker_id).toBe("SPK1")
    expect(samples[0]!.dialect).toBe("gonder")
  })

  it("decodes audio properties from the WAV bytes", async () => {
    const samples = await extractParquetSamples(fixturePath)

    expect(samples[0]!.sampleRate).toBe(8000)
    expect(samples[0]!.durationSeconds).toBeCloseTo(1, 5)
    expect(samples[1]!.sampleRate).toBe(16000)
    expect(samples[1]!.durationSeconds).toBeCloseTo(0.5, 5)
    expect(samples[0]!.audioBuffer.subarray(0, 4).toString()).toBe("RIFF")
  })

  it("respects the limit option", async () => {
    const samples = await extractParquetSamples(fixturePath, { limit: 1 })
    expect(samples).toHaveLength(1)
    expect(samples[0]!.id).toBe("gonder_row_0000")
  })

  it("respects the offset option", async () => {
    const samples = await extractParquetSamples(fixturePath, { offset: 1 })
    expect(samples[0]!.id).toBe("gonder_row_0001")
    expect(samples[0]!.metadata.text).toBe("እንዴት ነህ")
  })

  it("applies the filter option", async () => {
    const samples = await extractParquetSamples(fixturePath, {
      filter: (s) => s.metadata.gender === "male",
    })
    expect(samples).toHaveLength(1)
    expect(samples[0]!.metadata.gender).toBe("male")
  })
})

describe("parquetSource", () => {
  it("discovers fixture files with an absolute pattern", async () => {
    const discovery = await parquetSource.discover(`${tmp}/*/train-*.parquet`)
    expect(discovery.files).toHaveLength(1)
    expect(discovery.errors).toEqual([])
  })

  it("loads samples with metadata", async () => {
    const result = await parquetSource.load(fixturePath)
    expect(result.samples).toHaveLength(2)
    expect(result.metadata.loadedRows).toBe(2)
  })

  it("validates a file with all required columns", async () => {
    const result = await parquetSource.validate!(fixturePath)
    expect(result.valid).toBe(true)
    expect(result.missingColumns).toEqual([])
  })

  it("flags missing required columns", async () => {
    const result = await parquetSource.validate!(noDialectPath)
    expect(result.valid).toBe(false)
    expect(result.missingColumns).toEqual(["dialect"])
  })

  it("reports invalid for a nonexistent file", async () => {
    const result = await parquetSource.validate!(join(tmp, "missing.parquet"))
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
