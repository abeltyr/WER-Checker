import { describe, it, expect, beforeEach, afterAll } from "bun:test"
import { rm, readdir } from "node:fs/promises"
import { join } from "node:path"
import { runExtraction } from "../../../src/extract"
import { readJson } from "../../../src/storage"
import type { DataSource, LoadOptions } from "../../../src/sources/types"
import type { Sample } from "../../../src/core/types"
import { makeTmpDir, makeSample, makeWav } from "../../helpers"
import type { ManifestEntry } from "../../../src/extract"

let tmp: string
const tmpDirs: string[] = []

beforeEach(async () => {
  tmp = await makeTmpDir("wer-extract-")
  tmpDirs.push(tmp)
})

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })))
})

function makeMockSource(samplesByFile: Record<string, Sample[]>): DataSource & { loadCalls: Array<{ file: string; options?: LoadOptions }> } {
  const loadCalls: Array<{ file: string; options?: LoadOptions }> = []
  return {
    name: "mock",
    version: "1.0.0",
    capabilities: { streaming: false, batching: true, filtering: false, validation: false },
    loadCalls,
    discover: async () => ({ files: Object.keys(samplesByFile), errors: [] }),
    load: async (file, options) => {
      loadCalls.push({ file, options })
      let samples = samplesByFile[file] ?? []
      if (options?.offset) samples = samples.slice(options.offset)
      if (options?.limit !== undefined) samples = samples.slice(0, options.limit)
      return {
        samples,
        metadata: { totalRows: samples.length, loadedRows: samples.length, skippedRows: 0, errors: [] },
      }
    },
  }
}

function sampleSet(prefix: string, count: number): Sample[] {
  return Array.from({ length: count }, (_, i) =>
    makeSample({
      id: `${prefix}_row_${String(i).padStart(4, "0")}`,
      rowIndex: i,
      audioBuffer: makeWav({ numSamples: 100 + i }),
    }),
  )
}

describe("runExtraction", () => {
  it("writes WAV files and a manifest for every sample", async () => {
    const source = makeMockSource({
      "/data/a.parquet": sampleSet("gonder", 2),
      "/data/b.parquet": sampleSet("wollo", 2),
    })

    const result = await runExtraction(
      { dataPattern: "*", outputDir: tmp, audio: true },
      source,
    )

    expect(result.count).toBe(4)
    expect(result.files).toBe(2)

    const manifest = await readJson<ManifestEntry[]>(result.manifestPath)
    expect(manifest).toHaveLength(4)
    expect(manifest[0]!.id).toBe("gonder_row_0000")
    expect(manifest[0]!.text).toBe("ሰላም አለም")
    expect(manifest[0]!.gender).toBe("female")
    expect(manifest[0]!.audioFile).toBe(join("audio", "gonder_row_0000.wav"))

    const wavs = await readdir(join(tmp, "audio"))
    expect(wavs.sort()).toHaveLength(4)

    const written = await Bun.file(join(tmp, "audio", "gonder_row_0001.wav")).bytes()
    expect(Buffer.from(written).subarray(0, 4).toString()).toBe("RIFF")
    expect(written.length).toBe(44 + (100 + 1) * 2)
  })

  it("honors maxSamples across multiple files", async () => {
    const source = makeMockSource({
      "/data/a.parquet": sampleSet("gonder", 2),
      "/data/b.parquet": sampleSet("wollo", 2),
    })

    const result = await runExtraction(
      { dataPattern: "*", outputDir: tmp, maxSamples: 3, audio: true },
      source,
    )

    expect(result.count).toBe(3)
    // second file should only have been asked for the remaining 1 sample
    expect(source.loadCalls[1]!.options?.limit).toBe(1)
  })

  it("skips WAV writing with audio=false but still writes the manifest", async () => {
    const source = makeMockSource({ "/data/a.parquet": sampleSet("gonder", 2) })

    const result = await runExtraction(
      { dataPattern: "*", outputDir: tmp, audio: false },
      source,
    )

    const manifest = await readJson<ManifestEntry[]>(result.manifestPath)
    expect(manifest).toHaveLength(2)
    expect(manifest[0]!.audioFile).toBeUndefined()
    expect(manifest[0]!.audioBytes).toBeGreaterThan(0)

    const entries = await readdir(tmp)
    expect(entries).toEqual(["manifest.json"])
  })

  it("passes the offset through to the source", async () => {
    const source = makeMockSource({ "/data/a.parquet": sampleSet("gonder", 3) })

    const result = await runExtraction(
      { dataPattern: "*", outputDir: tmp, offset: 2, audio: false },
      source,
    )

    expect(source.loadCalls[0]!.options?.offset).toBe(2)
    expect(result.count).toBe(1)
  })

  it("produces an empty manifest when nothing matches", async () => {
    const source = makeMockSource({})
    const result = await runExtraction(
      { dataPattern: "*", outputDir: tmp, audio: true },
      source,
    )
    expect(result.count).toBe(0)
    expect(await readJson<ManifestEntry[]>(result.manifestPath)).toEqual([])
  })
})
