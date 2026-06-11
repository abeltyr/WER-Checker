import { describe, it, expect, beforeEach, afterAll } from "bun:test"
import { rm } from "node:fs/promises"
import { CheckpointManager } from "../../../src/checkpoint"
import { openResultsDb, ResultsDb } from "../../../src/storage/db"
import { makeTmpDir } from "../../helpers"

let tmp: string
let db: ResultsDb
const tmpDirs: string[] = []
const dbs: ResultsDb[] = []

beforeEach(async () => {
  tmp = await makeTmpDir("wer-checkpoint-")
  tmpDirs.push(tmp)
  db = openResultsDb(tmp)
  dbs.push(db)
})

afterAll(async () => {
  for (const d of dbs) d.close()
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })))
})

describe("CheckpointManager", () => {
  it("load returns null when no checkpoint exists", () => {
    const manager = new CheckpointManager(db, "run1")
    expect(manager.load()).toBeNull()
  })

  it("round-trips a checkpoint through the database", () => {
    const manager = new CheckpointManager(db, "run1")
    manager.setTotalSamples(10)
    manager.markProcessed("s1", true)
    manager.markProcessed("s2", false)
    manager.setLastProcessedIndex(1)
    manager.save()

    // A fresh connection to the same file proves the state is durable
    const reopened = openResultsDb(tmp)
    dbs.push(reopened)
    const fresh = new CheckpointManager(reopened, "run1")
    const loaded = fresh.load()

    expect(loaded).not.toBeNull()
    expect(loaded!.runId).toBe("run1")
    expect(loaded!.totalSamples).toBe(10)
    expect(loaded!.processedSampleIds).toEqual(["s1"])
    expect(loaded!.failedSampleIds).toEqual(["s2"])
    expect(loaded!.lastProcessedIndex).toBe(1)
  })

  it("persists markProcessed immediately, before any save()", () => {
    const manager = new CheckpointManager(db, "run1")
    manager.save() // checkpoint row must exist for load() to return it
    manager.markProcessed("s1", true)

    const fresh = new CheckpointManager(db, "run1")
    expect(fresh.load()!.processedSampleIds).toEqual(["s1"])
  })

  it("tracks success and failure counts without duplicates", () => {
    const manager = new CheckpointManager(db, "run1")
    manager.markProcessed("s1", true)
    manager.markProcessed("s1", true)
    manager.markProcessed("s2", false)
    manager.markProcessed("s2", false)

    expect(manager.getProcessedCount()).toBe(1)
    expect(manager.getFailedCount()).toBe(1)
  })

  it("a later success removes the sample from the failed list", () => {
    const manager = new CheckpointManager(db, "run1")
    manager.markProcessed("s1", false)
    expect(manager.getFailedCount()).toBe(1)

    manager.markProcessed("s1", true)
    expect(manager.getFailedCount()).toBe(0)
    expect(manager.getProcessedCount()).toBe(1)
  })

  it("isProcessed is true only for successful samples (failed ones retry on resume)", () => {
    const manager = new CheckpointManager(db, "run1")
    manager.markProcessed("ok", true)
    manager.markProcessed("bad", false)

    expect(manager.isProcessed("ok")).toBe(true)
    expect(manager.isProcessed("bad")).toBe(false)
    expect(manager.isProcessed("never-seen")).toBe(false)
  })

  it("keeps runs isolated from each other", () => {
    const run1 = new CheckpointManager(db, "run1")
    run1.markProcessed("s1", true)
    run1.save()

    const run2 = new CheckpointManager(db, "run2")
    expect(run2.load()).toBeNull()
    expect(run2.isProcessed("s1")).toBe(false)
  })

  it("reset clears memory and database state", () => {
    const manager = new CheckpointManager(db, "run1")
    manager.setTotalSamples(5)
    manager.markProcessed("s1", true)
    manager.markProcessed("s2", false)
    manager.save()

    manager.reset()

    expect(manager.getProcessedCount()).toBe(0)
    expect(manager.getFailedCount()).toBe(0)
    expect(manager.isProcessed("s1")).toBe(false)
    expect(new CheckpointManager(db, "run1").load()).toBeNull()
  })
})
