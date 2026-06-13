import { describe, it, expect } from "bun:test"
import { KNOWN_MODELS, getModelInfo, resolveProvider, estimateCostUsd } from "../../../src/ai/models"

describe("model registry", () => {
  it("contains Google, OpenAI, and Hasab transcription models", () => {
    const providers = new Set(KNOWN_MODELS.map((m) => m.provider))
    expect(providers).toEqual(new Set(["google", "openai", "hasab"]))
    expect(KNOWN_MODELS.length).toBeGreaterThanOrEqual(4)
  })

  it("every token-billed model has complete, positive pricing", () => {
    for (const m of KNOWN_MODELS) {
      // Dedicated ASR providers (Hasab) aren't token-billed and carry no pricing.
      if (!m.pricing) continue
      expect(m.pricing.inputPer1M).toBeGreaterThan(0)
      expect(m.pricing.audioInputPer1M).toBeGreaterThan(0)
      expect(m.pricing.outputPer1M).toBeGreaterThan(0)
    }
  })

  it("registers Hasab as a pricing-free ASR provider", () => {
    const hasab = getModelInfo("hasab-asr")!
    expect(hasab.provider).toBe("hasab")
    expect(hasab.pricing).toBeUndefined()
    // no pricing → cost is unavailable, never zero
    expect(estimateCostUsd("hasab-asr", { inputTokens: 1000, outputTokens: 0 })).toBeUndefined()
  })

  it("looks up models by id", () => {
    expect(getModelInfo("gemini-2.0-flash")!.provider).toBe("google")
    expect(getModelInfo("gpt-4o-audio-preview")!.provider).toBe("openai")
    expect(getModelInfo("nope")).toBeUndefined()
  })

  it("resolves providers for unknown models by prefix", () => {
    expect(resolveProvider("gpt-5-audio")).toBe("openai")
    expect(resolveProvider("gemini-9-ultra")).toBe("google")
    expect(resolveProvider("hasab-next")).toBe("hasab")
  })
})

describe("estimateCostUsd", () => {
  it("bills audio and text input at their own rates when the split is known", () => {
    // gemini-2.0-flash: text $0.10, audio $0.70, out $0.40 per 1M
    const cost = estimateCostUsd("gemini-2.0-flash", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      audioInputTokens: 600_000,
    })
    // 0.4M text × $0.10 + 0.6M audio × $0.70 + 1M out × $0.40
    expect(cost).toBeCloseTo(0.04 + 0.42 + 0.4, 6)
  })

  it("bills all input at the audio rate when the split is unknown", () => {
    const cost = estimateCostUsd("gemini-2.0-flash", {
      inputTokens: 1_000_000,
      outputTokens: 0,
    })
    expect(cost).toBeCloseTo(0.7, 6)
  })

  it("caps the audio share at the total input tokens", () => {
    const cost = estimateCostUsd("gemini-2.0-flash", {
      inputTokens: 100,
      outputTokens: 0,
      audioInputTokens: 500, // bogus value larger than input
    })
    expect(cost).toBeCloseTo((100 * 0.7) / 1_000_000, 9)
  })

  it("returns undefined for models without pricing data", () => {
    expect(estimateCostUsd("some-unknown-model", { inputTokens: 100, outputTokens: 10 })).toBeUndefined()
  })
})
