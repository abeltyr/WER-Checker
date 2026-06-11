import { describe, it, expect } from "bun:test"
import { createModel } from "../../../src/ai/client"

describe("createModel", () => {
  it("creates a model with the requested model id", () => {
    const configured = createModel({ model: "gemini-2.0-flash", thinkingBudget: 0, apiKey: "test-key" })
    expect((configured.model as any).modelId).toBe("gemini-2.0-flash")
  })

  it("omits provider options when thinking budget is 0", () => {
    const configured = createModel({ model: "gemini-2.0-flash", thinkingBudget: 0, apiKey: "test-key" })
    expect(configured.providerOptions).toBeUndefined()
  })

  it("passes the thinking budget through provider options when set", () => {
    const configured = createModel({ model: "gemini-2.5-flash", thinkingBudget: 1024, apiKey: "test-key" })
    expect(configured.providerOptions).toEqual({
      google: { thinkingConfig: { thinkingBudget: 1024 } },
    })
  })

  it("exposes the requested model id for pricing lookups", () => {
    const configured = createModel({ model: "gemini-2.0-flash", thinkingBudget: 0, apiKey: "test-key" })
    expect(configured.modelId).toBe("gemini-2.0-flash")
  })

  it("routes OpenAI model ids to the OpenAI provider", () => {
    const configured = createModel({
      model: "gpt-4o-audio-preview",
      thinkingBudget: 0,
      apiKey: "google-key",
      openaiApiKey: "openai-key",
    })
    expect((configured.model as any).modelId).toBe("gpt-4o-audio-preview")
    expect(configured.providerOptions).toBeUndefined() // thinking is Gemini-only
  })

  it("fails clearly when an OpenAI model is selected without an OpenAI key", () => {
    expect(() =>
      createModel({ model: "gpt-4o-audio-preview", thinkingBudget: 0, apiKey: "google-key" }),
    ).toThrow("OPENAI_API_KEY")
  })

  it("fails clearly when a Gemini model is selected without a Gemini key", () => {
    expect(() => createModel({ model: "gemini-2.0-flash", thinkingBudget: 0, apiKey: "" })).toThrow(
      "GEMINI_API_KEY",
    )
  })
})
