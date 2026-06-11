import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { mkdir, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { discoverParquetFiles } from "../../../../src/sources/parquet/discover"
import { makeTmpDir } from "../../../helpers"

let tmp: string

beforeAll(async () => {
  tmp = await makeTmpDir("wer-discover-")
  await mkdir(join(tmp, "gonder"), { recursive: true })
  await mkdir(join(tmp, "wollo"), { recursive: true })
  await writeFile(join(tmp, "gonder", "train-00001.parquet"), "")
  await writeFile(join(tmp, "gonder", "train-00000.parquet"), "")
  await writeFile(join(tmp, "wollo", "train-00000.parquet"), "")
  await writeFile(join(tmp, "gonder", "test-00000.parquet"), "")
  await writeFile(join(tmp, "gonder", "notes.txt"), "")
})

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe("discoverParquetFiles", () => {
  it("finds files matching the glob pattern, sorted", async () => {
    const files = await discoverParquetFiles(`${tmp}/*/train-*.parquet`)

    expect(files).toHaveLength(3)
    expect(files[0]).toContain("gonder/train-00000.parquet")
    expect(files[1]).toContain("gonder/train-00001.parquet")
    expect(files[2]).toContain("wollo/train-00000.parquet")
  })

  it("excludes files that do not match", async () => {
    const files = await discoverParquetFiles(`${tmp}/*/train-*.parquet`)
    expect(files.some((f) => f.includes("test-00000"))).toBe(false)
    expect(files.some((f) => f.includes("notes.txt"))).toBe(false)
  })

  it("returns an empty array when nothing matches", async () => {
    const files = await discoverParquetFiles(`${tmp}/nonexistent/*.parquet`)
    expect(files).toEqual([])
  })
})
