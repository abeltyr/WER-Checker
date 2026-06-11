import { describe, it, expect } from "bun:test"
import { toReportSample } from "../../../src/core/types"
import { makeSample } from "../../helpers"

describe("toReportSample", () => {
  it("drops the audio buffer and records its size", () => {
    const sample = makeSample()
    const report = toReportSample(sample)

    expect("audioBuffer" in report).toBe(false)
    expect(report.audioBytes).toBe(sample.audioBuffer.length)
  })

  it("preserves all other fields", () => {
    const sample = makeSample({ id: "x_row_0042", dialect: "wollo", rowIndex: 42 })
    const report = toReportSample(sample)

    expect(report.id).toBe("x_row_0042")
    expect(report.dialect).toBe("wollo")
    expect(report.rowIndex).toBe(42)
    expect(report.metadata).toEqual(sample.metadata)
    expect(report.durationSeconds).toBe(sample.durationSeconds)
    expect(report.sampleRate).toBe(sample.sampleRate)
  })

  it("does not mutate the original sample", () => {
    const sample = makeSample()
    toReportSample(sample)
    expect(Buffer.isBuffer(sample.audioBuffer)).toBe(true)
  })
})
