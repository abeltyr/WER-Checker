import { describe, it, expect, beforeEach } from "bun:test"
import { MetricsCollector } from "../../../src/utils/metrics"

let collector: MetricsCollector

beforeEach(() => {
  collector = new MetricsCollector()
})

function record(overrides: Partial<Parameters<MetricsCollector["recordSample"]>[0]> = {}) {
  collector.recordSample({
    success: true,
    wer: 0.2,
    cer: 0.1,
    mer: 0.15,
    wil: 0.25,
    bleu: 0.8,
    latencyMs: 100,
    tokensUsed: 50,
    ...overrides,
  })
}

describe("MetricsCollector", () => {
  it("starts at zero", () => {
    const metrics = collector.getMetrics()
    expect(metrics.samplesProcessed).toBe(0)
    expect(metrics.samplesSuccessful).toBe(0)
    expect(metrics.samplesFailed).toBe(0)
    expect(metrics.totalTokens).toBe(0)
  })

  it("averages quality metrics over successful samples only", () => {
    record({ wer: 0.2 })
    record({ wer: 0.4 })
    record({ success: false, wer: 0.99 }) // failures don't pollute quality averages

    const metrics = collector.getMetrics()
    expect(metrics.samplesProcessed).toBe(3)
    expect(metrics.samplesSuccessful).toBe(2)
    expect(metrics.samplesFailed).toBe(1)
    expect(metrics.avgWER).toBeCloseTo(0.3, 5)
  })

  it("averages latency and tokens over all samples", () => {
    record({ latencyMs: 100, tokensUsed: 40 })
    record({ success: false, latencyMs: 300, tokensUsed: 0 })

    const metrics = collector.getMetrics()
    expect(metrics.avgLatencyMs).toBe(200)
    expect(metrics.totalTokens).toBe(40)
    expect(metrics.avgTokensPerSample).toBe(20)
  })

  it("resets all counters", () => {
    record()
    collector.reset()

    const metrics = collector.getMetrics()
    expect(metrics.samplesProcessed).toBe(0)
    expect(metrics.totalTokens).toBe(0)
  })
})

describe("toPrometheusFormat", () => {
  it("exports HELP/TYPE annotated metrics", () => {
    record({ wer: 0.25 })
    const output = collector.toPrometheusFormat()

    expect(output).toContain("# HELP wer_samples_processed")
    expect(output).toContain("# TYPE wer_samples_processed counter")
    expect(output).toContain("wer_samples_processed 1")
    expect(output).toContain("wer_avg_wer 0.2500")
    expect(output).toContain("wer_total_tokens 50")
  })

  it("emits parseable lines (no NaN)", () => {
    const output = collector.toPrometheusFormat()
    expect(output).not.toContain("NaN")
    for (const line of output.split("\n")) {
      expect(line.startsWith("#") || /^[a-z_]+ [\d.]+$/.test(line)).toBe(true)
    }
  })
})
