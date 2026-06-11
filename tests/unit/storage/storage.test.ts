import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { ensureDir, writeJson, readJson } from "../../../src/storage"
import { makeTmpDir } from "../../helpers"

let tmp: string

beforeAll(async () => {
  tmp = await makeTmpDir("wer-storage-")
})

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe("ensureDir", () => {
  it("creates nested directories and is idempotent", async () => {
    const dir = join(tmp, "a", "b", "c")
    await ensureDir(dir)
    await ensureDir(dir)
    expect((await stat(dir)).isDirectory()).toBe(true)
  })
})

describe("writeJson / readJson", () => {
  it("round-trips data through disk", async () => {
    const filePath = join(tmp, "nested", "dir", "data.json")
    const data = { name: "ሰላም", values: [1, 2, 3], flag: true }

    await writeJson(filePath, data)
    const loaded = await readJson<typeof data>(filePath)

    expect(loaded).toEqual(data)
  })

  it("writes pretty-printed JSON", async () => {
    const filePath = join(tmp, "pretty.json")
    await writeJson(filePath, { a: 1 })
    const raw = await Bun.file(filePath).text()
    expect(raw).toContain("\n")
  })

  it("readJson rejects on missing file", async () => {
    await expect(readJson(join(tmp, "missing.json"))).rejects.toThrow()
  })
})
