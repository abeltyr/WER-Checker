import { describe, it, expect, beforeAll } from "bun:test"
import { join } from "node:path"
import { mkdir, writeFile, readdir } from "node:fs/promises"
import { runNormalize } from "../../../src/normalize"
import { readJson, writeJson } from "../../../src/storage"
import { makeTmpDir, makeWav } from "../../helpers"
import type { ManifestEntry } from "../../../src/extract"
import type { DataPoint } from "../../../src/core/types"

function makeManifestEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  const id = overrides.id ?? "gonder_row_0000"
  return {
    id,
    text: "ሰላም አለም",
    dialect: "gonder",
    gender: "female",
    speakerId: "SPK1",
    durationSeconds: 1,
    sampleRate: 8000,
    audioBytes: 16044,
    audioFile: `audio/${id}.wav`,
    sourceFile: "/test/fixture.parquet",
    rowIndex: 0,
    ...overrides,
  }
}

/** Build a data/extracted-style input dir: manifest.json + audio/*.wav. */
async function makeExtractedDir(entries: ManifestEntry[], wavIds: string[]): Promise<string> {
  const dir = await makeTmpDir("wer-normalize-")
  await mkdir(join(dir, "audio"), { recursive: true })
  await writeJson(join(dir, "manifest.json"), entries)
  for (const id of wavIds) {
    await writeFile(join(dir, "audio", `${id}.wav`), makeWav())
  }
  return dir
}

describe("runNormalize — extracted case", () => {
  let inputDir: string
  let outputDir: string

  beforeAll(async () => {
    inputDir = await makeExtractedDir(
      [
        makeManifestEntry({ id: "gonder_row_0000" }),
        // gender/dialect need normalising, text has messy whitespace
        makeManifestEntry({
          id: "gonder_row_0001",
          text: "  ሰላም\n\n አለም ",
          gender: "Female",
          dialect: " Gonder ",
          rowIndex: 1,
        }),
        makeManifestEntry({ id: "gonder_row_0002", text: "   ", rowIndex: 2 }), // empty transcript
        makeManifestEntry({ id: "gonder_row_0003", rowIndex: 3 }), // wav missing on disk
        makeManifestEntry({ id: "gonder_row_0000", rowIndex: 4 }), // duplicate id
      ],
      ["gonder_row_0000", "gonder_row_0001", "gonder_row_0002"],
    )
    outputDir = await makeTmpDir("wer-dataset-")
    await runNormalize({ inputDir, outputDir })
  })

  it("writes one folder per valid sample containing wav + json", async () => {
    const folders = (await readdir(outputDir)).sort()
    expect(folders).toEqual(["gonder_row_0000", "gonder_row_0001"])

    const files = (await readdir(join(outputDir, "gonder_row_0000"))).sort()
    expect(files).toEqual(["gonder_row_0000.json", "gonder_row_0000.wav"])
  })

  it("produces a canonical data point with normalised fields", async () => {
    const point = await readJson<DataPoint>(
      join(outputDir, "gonder_row_0001", "gonder_row_0001.json"),
    )

    expect(point.id).toBe("gonder_row_0001")
    expect(point.audioFile).toBe("gonder_row_0001.wav")
    expect(point.text).toBe("ሰላም አለም") // whitespace collapsed
    expect(point.gender).toBe("female") // lowercased
    expect(point.dialect).toBe("gonder") // trimmed + lowercased
    expect(point.speakerCount).toBe(1)
    expect(point.source).toEqual({ case: "extracted", file: "/test/fixture.parquet", rowIndex: 1 })
  })

  it("takes duration and sample rate from the WAV header, not the manifest", async () => {
    const point = await readJson<DataPoint>(
      join(outputDir, "gonder_row_0000", "gonder_row_0000.json"),
    )
    // makeWav() default: 1 second of 8 kHz mono 16-bit
    expect(point.sampleRate).toBe(8000)
    expect(point.durationSeconds).toBe(1)
    expect(point.audioBytes).toBe(makeWav().length)
  })

  it("reports every skipped entry with its reason", async () => {
    const result = await runNormalize({ inputDir, outputDir: await makeTmpDir("wer-dataset-") })

    expect(result.written).toBe(2)
    expect(result.skipped).toEqual([
      { id: "gonder_row_0002", reason: "empty transcript" },
      { id: "gonder_row_0003", reason: "audio file not found: audio/gonder_row_0003.wav" },
      { id: "gonder_row_0000", reason: "duplicate id" },
    ])
  })
})

describe("runNormalize — guards", () => {
  it("rejects an unknown cleanup case", async () => {
    const dir = await makeTmpDir("wer-normalize-")
    expect(runNormalize({ inputDir: dir, outputDir: dir, case: "nope" })).rejects.toThrow(
      'Unknown cleanup case "nope"',
    )
  })

  it("respects maxSamples", async () => {
    const inputDir = await makeExtractedDir(
      [makeManifestEntry({ id: "a" }), makeManifestEntry({ id: "b", rowIndex: 1 })],
      ["a", "b"],
    )
    const outputDir = await makeTmpDir("wer-dataset-")

    const result = await runNormalize({ inputDir, outputDir, maxSamples: 1 })
    expect(result.written).toBe(1)
    expect(await readdir(outputDir)).toEqual(["a"])
  })

  it("skips entries whose WAV has an invalid header", async () => {
    const inputDir = await makeExtractedDir([makeManifestEntry({ id: "bad" })], [])
    await writeFile(join(inputDir, "audio", "bad.wav"), Buffer.from("not a wav file at all, padded to 44+ bytes"))
    const outputDir = await makeTmpDir("wer-dataset-")

    const result = await runNormalize({ inputDir, outputDir })
    expect(result.written).toBe(0)
    expect(result.skipped).toEqual([{ id: "bad", reason: "invalid WAV header" }])
  })
})
