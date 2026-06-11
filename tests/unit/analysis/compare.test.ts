import { describe, it, expect } from "bun:test"
import { computeTextDimension, computeMER, computeWIL, computeBLEU } from "../../../src/analysis/compare"

describe("computeTextDimension", () => {
  it("should handle identical strings", () => {
    const result = computeTextDimension("hello world", "hello world")
    expect(result.wer).toBe(0)
    expect(result.cer).toBe(0)
  })

  it("should handle empty strings", () => {
    const result = computeTextDimension("", "")
    expect(result.wer).toBe(0)
    expect(result.cer).toBe(0)
  })

  it("should handle reference empty but hypothesis non-empty", () => {
    const result = computeTextDimension("", "hello")
    expect(result.wordCount.reference).toBe(0)
    expect(result.wordCount.hypothesis).toBe(1)
    expect(result.wer).toBe(0)
  })

  it("should count deletions correctly", () => {
    const result = computeTextDimension("hello world", "hello")
    expect(result.wer).toBe(0.5)
    expect(result.errors.deletions).toBe(1)
  })

  it("should count insertions correctly", () => {
    const result = computeTextDimension("hello", "hello world")
    expect(result.wer).toBe(1)
    expect(result.errors.insertions).toBe(1)
    expect(result.errors.total).toBe(1)
  })

  it("should count substitutions correctly", () => {
    const result = computeTextDimension("hello world", "hello earth")
    expect(result.wer).toBe(0.5)
    expect(result.errors.substitutions).toBe(1)
  })

  it("should handle multiple errors", () => {
    const result = computeTextDimension("hello world today", "hi earth tomorrow")
    expect(result.errors.substitutions).toBeGreaterThan(0)
    expect(result.errors.deletions + result.errors.insertions + result.errors.substitutions).toBe(3)
  })
})

describe("computeTextDimension - Amharic", () => {
  it("should handle identical Amharic strings", () => {
    const result = computeTextDimension("ሰላም አለም", "ሰላም አለም")
    expect(result.wer).toBe(0)
    expect(result.cer).toBe(0)
  })

  it("should handle Amharic transcription errors", () => {
    const result = computeTextDimension("ሰላም", "ሰለም")
    expect(result.wer).toBe(1)
    expect(result.errors.substitutions).toBe(1)
  })

  it("should handle mixed Amharic and English", () => {
    const result = computeTextDimension("ሰላም hello", "ሰላም hi")
    expect(result.errors.substitutions).toBe(1)
  })

  it("should handle Amharic Unicode correctly", () => {
    const result = computeTextDimension("ፖለቲካ", "ፖለቲካ")
    expect(result.wer).toBe(0)
  })

  it("should handle diacritics in Amharic", () => {
    const result1 = computeTextDimension("ሀ", "ሀ")
    expect(result1.wer).toBe(0)
  })

  it("should ignore Ethiopic punctuation (። full stop)", () => {
    const result = computeTextDimension("ወደ ገበያ ልሄድ ነው።", "ወደ ገበያ ልሄድ ነው")
    expect(result.wer).toBe(0)
  })

  it("should ignore Ethiopic punctuation (፣ comma)", () => {
    const result = computeTextDimension("ሰላም፣ አለም", "ሰላም አለም")
    expect(result.wer).toBe(0)
  })

  it("should treat Ethiopic wordspace (፡) as a separator", () => {
    const result = computeTextDimension("ሰላም፡አለም", "ሰላም አለም")
    expect(result.wer).toBe(0)
  })
})

describe("computeTextDimension - Edge Cases", () => {
  it("should handle numbers", () => {
    const result = computeTextDimension("123 456", "123 456")
    expect(result.wer).toBe(0)
  })

  it("should handle punctuation stripping", () => {
    const result = computeTextDimension("hello, world!", "hello world")
    expect(result.wer).toBe(0)
  })

  it("should handle extra whitespace", () => {
    const result = computeTextDimension("hello  world", "hello world")
    expect(result.wer).toBe(0)
  })

  it("should handle very long strings", () => {
    const longText = "word ".repeat(1000)
    const result = computeTextDimension(longText, longText)
    expect(result.wer).toBe(0)
    expect(result.wordCount.reference).toBe(1000)
  })

  it("should handle single character difference in CER", () => {
    const result = computeTextDimension("test", "tost")
    expect(result.cer).toBe(0.25)
    expect(result.wer).toBe(1)
  })

  it("errors.total is the sum of substitutions, deletions, and insertions", () => {
    const result = computeTextDimension("aa bb cc dd", "aa bb xx")
    // cc→xx substituted, dd deleted
    expect(result.errors).toEqual({ substitutions: 1, deletions: 1, insertions: 0, total: 2 })
  })
})

describe("MER (Match Error Rate)", () => {
  it("is 0 for identical strings", () => {
    expect(computeMER("ሀ ለ ሐ መ", "ሀ ለ ሐ መ")).toBe(0)
  })

  it("is E / (H + E)", () => {
    // S=1, D=1, I=0 → E=2; H = 4 - 1 - 1 = 2 → MER = 2/4
    expect(computeMER("aa bb cc dd", "aa bb xx")).toBeCloseTo(0.5, 5)
  })

  it("is 1 when every word is substituted", () => {
    expect(computeMER("aa bb", "xx yy")).toBe(1)
  })
})

describe("WIL (Word Information Lost)", () => {
  it("is 0 for identical strings", () => {
    expect(computeWIL("ሀ ለ ሐ መ", "ሀ ለ ሐ መ")).toBe(0)
  })

  it("is 1 − H²/(N1·N2)", () => {
    // H=2, N1=4, N2=3 → 1 − 4/12
    expect(computeWIL("aa bb cc dd", "aa bb xx")).toBeCloseTo(2 / 3, 5)
  })

  it("is 1 when nothing matches", () => {
    expect(computeWIL("aa bb", "xx yy")).toBe(1)
    expect(computeWIL("aa bb", "")).toBe(1)
  })
})

describe("BLEU", () => {
  it("is 1 for identical strings", () => {
    expect(computeBLEU("ሀ ለ ሐ መ ሠ", "ሀ ለ ሐ መ ሠ")).toBeCloseTo(1, 5)
    expect(computeBLEU("ሀ", "ሀ")).toBeCloseTo(1, 5)
  })

  it("is 0 when no n-grams match", () => {
    expect(computeBLEU("aa bb", "xx yy")).toBe(0)
    expect(computeBLEU("", "aa")).toBe(0)
    expect(computeBLEU("aa", "")).toBe(0)
  })

  it("weights by the n-gram orders the texts can support", () => {
    // only unigrams possible: precision 1/2, no brevity penalty
    expect(computeBLEU("aa", "aa bb")).toBeCloseTo(0.5, 5)
  })

  it("applies the brevity penalty for short hypotheses", () => {
    // unigram precision 1, BP = exp(1 - 2/1)
    expect(computeBLEU("aa bb", "aa")).toBeCloseTo(Math.exp(-1), 5)
  })
})
