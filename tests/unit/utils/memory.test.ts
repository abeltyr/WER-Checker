import { describe, it, expect } from "bun:test"
import {
  getMemoryUsage,
  formatBytes,
  checkMemoryThresholds,
  forceGarbageCollection,
  MemoryMonitor,
  estimateAudioBufferSize,
} from "../../../src/utils/memory"

describe("getMemoryUsage", () => {
  it("returns positive memory figures", () => {
    const mem = getMemoryUsage()
    expect(mem.heapUsed).toBeGreaterThan(0)
    expect(mem.heapTotal).toBeGreaterThan(0)
    expect(mem.rss).toBeGreaterThan(0)
  })
})

describe("formatBytes", () => {
  it("formats bytes as megabytes with two decimals", () => {
    expect(formatBytes(1048576)).toBe("1.00 MB")
    expect(formatBytes(0)).toBe("0.00 MB")
    expect(formatBytes(1572864)).toBe("1.50 MB")
  })
})

describe("checkMemoryThresholds", () => {
  it("passes with generous thresholds", () => {
    const result = checkMemoryThresholds({ heapUsedMB: 100000, heapTotalMB: 100000, rssMB: 100000 })
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it("warns when usage exceeds tiny thresholds", () => {
    const result = checkMemoryThresholds({ heapUsedMB: 0.001, rssMB: 0.001 })
    expect(result.ok).toBe(false)
    expect(result.warnings.length).toBeGreaterThanOrEqual(2)
  })

  it("skips checks for unset thresholds", () => {
    const result = checkMemoryThresholds({})
    expect(result.ok).toBe(true)
  })
})

describe("forceGarbageCollection", () => {
  it("resolves without error", async () => {
    await forceGarbageCollection()
  })
})

describe("MemoryMonitor", () => {
  it("starts and stops cleanly", () => {
    const monitor = new MemoryMonitor({ heapUsedMB: 100000, rssMB: 100000 })
    monitor.start(60000)
    monitor.stop()
    monitor.stop() // idempotent
  })
})

describe("estimateAudioBufferSize", () => {
  it("estimates bytes from sample count and duration", () => {
    // 10 samples × 10s × 8000 Hz × 2 bytes
    expect(estimateAudioBufferSize(10)).toBe(10 * 10 * 8000 * 2)
    expect(estimateAudioBufferSize(5, 2)).toBe(5 * 2 * 8000 * 2)
  })
})
