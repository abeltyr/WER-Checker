export interface Metrics {
  samplesProcessed: number
  samplesSuccessful: number
  samplesFailed: number
  avgWER: number
  avgCER: number
  avgMER: number
  avgWIL: number
  avgBLEU: number
  avgLatencyMs: number
  totalTokens: number
  avgTokensPerSample: number
  totalCostUsd: number
}

export interface PrometheusMetric {
  name: string
  help: string
  type: "counter" | "gauge" | "histogram"
  values: Array<{
    value: number
    labels?: Record<string, string>
  }>
}

export class MetricsCollector {
  private samplesProcessed = 0
  private samplesSuccessful = 0
  private samplesFailed = 0
  private totalWER = 0
  private totalCER = 0
  private totalMER = 0
  private totalWIL = 0
  private totalBLEU = 0
  private totalLatencyMs = 0
  private totalTokens = 0
  private totalCostUsd = 0

  recordSample(result: {
    success: boolean
    wer: number
    cer: number
    mer: number
    wil: number
    bleu: number
    latencyMs: number
    tokensUsed: number
    costUsd?: number
  }): void {
    this.samplesProcessed++
    if (result.success) {
      this.samplesSuccessful++
      this.totalWER += result.wer
      this.totalCER += result.cer
      this.totalMER += result.mer
      this.totalWIL += result.wil
      this.totalBLEU += result.bleu
    } else {
      this.samplesFailed++
    }
    this.totalLatencyMs += result.latencyMs
    this.totalTokens += result.tokensUsed
    this.totalCostUsd += result.costUsd ?? 0
  }

  getMetrics(): Metrics {
    const successful = this.samplesSuccessful || 1
    return {
      samplesProcessed: this.samplesProcessed,
      samplesSuccessful: this.samplesSuccessful,
      samplesFailed: this.samplesFailed,
      avgWER: this.totalWER / successful,
      avgCER: this.totalCER / successful,
      avgMER: this.totalMER / successful,
      avgWIL: this.totalWIL / successful,
      avgBLEU: this.totalBLEU / successful,
      avgLatencyMs: this.totalLatencyMs / (this.samplesProcessed || 1),
      totalTokens: this.totalTokens,
      avgTokensPerSample: this.totalTokens / (this.samplesProcessed || 1),
      totalCostUsd: this.totalCostUsd,
    }
  }

  toPrometheusFormat(): string {
    const metrics = this.getMetrics()
    const lines: string[] = []

    lines.push("# HELP wer_samples_processed Total number of samples processed")
    lines.push("# TYPE wer_samples_processed counter")
    lines.push(`wer_samples_processed ${metrics.samplesProcessed}`)

    lines.push("# HELP wer_samples_successful Number of successful samples")
    lines.push("# TYPE wer_samples_successful counter")
    lines.push(`wer_samples_successful ${metrics.samplesSuccessful}`)

    lines.push("# HELP wer_samples_failed Number of failed samples")
    lines.push("# TYPE wer_samples_failed counter")
    lines.push(`wer_samples_failed ${metrics.samplesFailed}`)

    lines.push("# HELP wer_avg_wer Average Word Error Rate")
    lines.push("# TYPE wer_avg_wer gauge")
    lines.push(`wer_avg_wer ${metrics.avgWER.toFixed(4)}`)

    lines.push("# HELP wer_avg_cer Average Character Error Rate")
    lines.push("# TYPE wer_avg_cer gauge")
    lines.push(`wer_avg_cer ${metrics.avgCER.toFixed(4)}`)

    lines.push("# HELP wer_avg_bleu Average BLEU score")
    lines.push("# TYPE wer_avg_bleu gauge")
    lines.push(`wer_avg_bleu ${metrics.avgBLEU.toFixed(4)}`)

    lines.push("# HELP wer_avg_latency_ms Average latency in milliseconds")
    lines.push("# TYPE wer_avg_latency_ms gauge")
    lines.push(`wer_avg_latency_ms ${metrics.avgLatencyMs}`)

    lines.push("# HELP wer_total_tokens Total tokens used")
    lines.push("# TYPE wer_total_tokens counter")
    lines.push(`wer_total_tokens ${metrics.totalTokens}`)

    lines.push("# HELP wer_total_cost_usd Estimated total cost in USD")
    lines.push("# TYPE wer_total_cost_usd counter")
    lines.push(`wer_total_cost_usd ${metrics.totalCostUsd.toFixed(6)}`)

    return lines.join("\n")
  }

  reset(): void {
    this.samplesProcessed = 0
    this.samplesSuccessful = 0
    this.samplesFailed = 0
    this.totalWER = 0
    this.totalCER = 0
    this.totalMER = 0
    this.totalWIL = 0
    this.totalBLEU = 0
    this.totalLatencyMs = 0
    this.totalTokens = 0
    this.totalCostUsd = 0
  }
}

export const metricsCollector = new MetricsCollector()
