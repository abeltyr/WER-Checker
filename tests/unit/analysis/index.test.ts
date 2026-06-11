import { describe, it, expect } from "bun:test"
import { compareAll } from "../../../src/analysis"
import { makeSample, makeAiResult, makeGeminiOutput } from "../../helpers"

describe("compareAll", () => {
  it("scores a perfect transcription with zero WER and full matches", () => {
    const sample = makeSample() // reference text: ሰላም አለም, female, gonder
    const ai = makeAiResult({ parsedResponse: makeGeminiOutput("ሰላም አለም") })

    const result = compareAll(sample, ai)

    expect(result.sampleId).toBe(sample.id)
    expect(result.dimensions.text.wer).toBe(0)
    expect(result.dimensions.gender.match).toBe(true)
    expect(result.dimensions.dialect.match).toBe(true) // predicted "gonder" vs dialect "gonder"
    expect(result.dimensions.speakerCount.match).toBe(true)
  })

  it("matches gender case-insensitively", () => {
    const sample = makeSample({ metadata: { text: "ሰላም", gender: "Female", dialect: "gonder" } })
    const ai = makeAiResult({ parsedResponse: makeGeminiOutput("ሰላም", { gender: "female" }) })

    expect(compareAll(sample, ai).dimensions.gender.match).toBe(true)
  })

  it("trims surrounding whitespace from the predicted transcription", () => {
    const sample = makeSample() // reference: ሰላም አለም
    const ai = makeAiResult({ parsedResponse: makeGeminiOutput("  ሰላም አለም\n") })

    const result = compareAll(sample, ai)
    expect(result.dimensions.text.hypothesisText).toBe("ሰላም አለም")
    expect(result.dimensions.text.wer).toBe(0)
  })

  it("handles a missing parsed response as an empty hypothesis", () => {
    const sample = makeSample()
    const ai = makeAiResult({ success: false, parsedResponse: undefined })

    const result = compareAll(sample, ai)
    expect(result.dimensions.text.hypothesisText).toBe("")
    expect(result.dimensions.text.wer).toBe(1) // all reference words deleted
    expect(result.dimensions.gender.predicted).toBe("unknown")
    expect(result.dimensions.dialect.predicted).toBe("unknown")
    expect(result.dimensions.gender.match).toBe(false)
  })

  it("compares the predicted speaker count against the reference", () => {
    const ai = makeAiResult({ parsedResponse: makeGeminiOutput("ሰላም", { speaker_count: 2 }) })

    const result = compareAll(makeSample(), ai)
    expect(result.dimensions.speakerCount.predicted).toBe("2")
    expect(result.dimensions.speakerCount.match).toBe(false) // reference defaults to 1
  })

  it("uses the speaker_count from sample metadata as the reference", () => {
    const sample = makeSample({
      metadata: { text: "ሰላም", gender: "female", dialect: "gonder", speaker_count: 2 },
    })
    const ai = makeAiResult({ parsedResponse: makeGeminiOutput("ሰላም", { speaker_count: 2 }) })

    const result = compareAll(sample, ai)
    expect(result.dimensions.speakerCount.reference).toBe("2")
    expect(result.dimensions.speakerCount.match).toBe(true)
  })

  it("falls back to the sample dialect when metadata has none", () => {
    const sample = makeSample({ dialect: "wollo", metadata: { text: "ሰላም" } })
    const ai = makeAiResult({ parsedResponse: undefined })

    expect(compareAll(sample, ai).dimensions.dialect.reference).toBe("wollo")
  })

  it("treats malformed field types in a loosely-parsed response as absent", () => {
    const sample = makeSample()
    const ai = makeAiResult({
      parsedResponse: {
        transcription: 42,
        gender: "",
        dialect: null,
        speaker_count: "two",
      } as never,
    })

    const result = compareAll(sample, ai)
    expect(result.dimensions.text.hypothesisText).toBe("")
    expect(result.dimensions.gender.predicted).toBe("unknown")
    expect(result.dimensions.dialect.predicted).toBe("unknown")
    expect(result.dimensions.speakerCount.predicted).toBe("0")
  })
})
