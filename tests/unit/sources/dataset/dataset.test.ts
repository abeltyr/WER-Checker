import { describe, it, expect, beforeAll } from "bun:test"
import { join } from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { datasetSource } from "../../../../src/sources/dataset"
import { writeJson } from "../../../../src/storage"
import { makeTmpDir, makeWav } from "../../../helpers"
import type { DataPoint } from "../../../../src/core/types"

function makeDataPoint(id: string, overrides: Partial<DataPoint> = {}): DataPoint {
  return {
    id,
    audioFile: `${id}.wav`,
    text: "ሰላም አለም",
    dialect: "gonder",
    gender: "female",
    speakerId: "SPK1",
    speakerCount: 1,
    durationSeconds: 1,
    sampleRate: 8000,
    audioBytes: makeWav().length,
    source: { case: "extracted", file: "/test/fixture.parquet", rowIndex: 0 },
    ...overrides,
  }
}

async function writeSampleFolder(datasetDir: string, point: DataPoint): Promise<void> {
  const dir = join(datasetDir, point.id)
  await mkdir(dir, { recursive: true })
  await writeJson(join(dir, `${point.id}.json`), point)
  await writeFile(join(dir, point.audioFile), makeWav())
}

describe("datasetSource", () => {
  let datasetDir: string

  beforeAll(async () => {
    datasetDir = await makeTmpDir("wer-dataset-src-")
    await writeSampleFolder(datasetDir, makeDataPoint("row_0000"))
    await writeSampleFolder(datasetDir, makeDataPoint("row_0001", { gender: "male" }))
    await writeSampleFolder(datasetDir, makeDataPoint("row_0002"))
  })

  it("discovers the dataset directory as a single loadable unit", async () => {
    const result = await datasetSource.discover(datasetDir)
    expect(result.files).toEqual([datasetDir])
    expect(result.errors).toEqual([])
  })

  it("reports an error for a missing directory", async () => {
    const result = await datasetSource.discover("/no/such/dataset")
    expect(result.files).toEqual([])
    expect(result.errors[0]!.reason).toBe("directory not found")
  })

  it("loads every sample with audio and canonical metadata", async () => {
    const { samples, metadata } = await datasetSource.load(datasetDir)

    expect(metadata.totalRows).toBe(3)
    expect(samples.map((s) => s.id)).toEqual(["row_0000", "row_0001", "row_0002"])

    const sample = samples[0]!
    expect(sample.source).toBe("dataset")
    expect(sample.audioMimeType).toBe("audio/wav")
    expect(sample.audioBuffer.subarray(0, 4).toString()).toBe("RIFF")
    expect(sample.metadata).toEqual({
      text: "ሰላም አለም",
      dialect: "gonder",
      gender: "female",
      speaker_id: "SPK1",
      speaker_count: 1,
    })
  })

  it("applies limit and offset over the sorted sample folders", async () => {
    const { samples, metadata } = await datasetSource.load(datasetDir, { limit: 1, offset: 1 })
    expect(samples.map((s) => s.id)).toEqual(["row_0001"])
    expect(samples[0]!.rowIndex).toBe(1)
    expect(metadata.totalRows).toBe(3)
  })

  it("applies the sample filter", async () => {
    const { samples } = await datasetSource.load(datasetDir, {
      filter: (s) => s.metadata.gender === "male",
    })
    expect(samples.map((s) => s.id)).toEqual(["row_0001"])
  })

  it("records an error instead of failing the load when a sample is broken", async () => {
    const brokenDir = await makeTmpDir("wer-dataset-broken-")
    await writeSampleFolder(brokenDir, makeDataPoint("ok_0000"))
    await mkdir(join(brokenDir, "broken_0001"), { recursive: true }) // no json inside

    const { samples, metadata } = await datasetSource.load(brokenDir)
    expect(samples.map((s) => s.id)).toEqual(["ok_0000"])
    expect(metadata.errors).toHaveLength(1)
    expect(metadata.errors[0]!.row).toBe(0) // sorted: broken_0001 first
  })

  it("validates the canonical structure", async () => {
    expect((await datasetSource.validate!(datasetDir)).valid).toBe(true)

    const emptyDir = await makeTmpDir("wer-dataset-empty-")
    const empty = await datasetSource.validate!(emptyDir)
    expect(empty.valid).toBe(false)
    expect(empty.errors).toEqual(["no sample folders found"])
  })
})
