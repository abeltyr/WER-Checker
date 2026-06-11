import { describe, it, expect } from "bun:test"
import { createGoogleModel, createOpenAIModel } from "../../../src/ai/providers"

describe("createGoogleModel", () => {
  it("configures the requested Gemini model", () => {
    const configured = createGoogleModel({ model: "gemini-2.0-flash", thinkingBudget: 0, apiKey: "k" })
    expect(configured.modelId).toBe("gemini-2.0-flash")
    expect((configured.model as any).modelId).toBe("gemini-2.0-flash")
  })

  it("requires a Gemini key", () => {
    expect(() => createGoogleModel({ model: "gemini-2.0-flash", thinkingBudget: 0, apiKey: "" }))
      .toThrow("GEMINI_API_KEY")
  })

  it("merges the thinking budget into providerOptions", () => {
    const configured = createGoogleModel({
      model: "gemini-2.5-flash",
      thinkingBudget: 512,
      apiKey: "k",
      options: { providerOptions: { google: { safetySettings: [] } } },
    })
    expect(configured.providerOptions).toEqual({
      google: { safetySettings: [], thinkingConfig: { thinkingBudget: 512 } },
    })
  })
})

describe("createOpenAIModel", () => {
  it("configures the requested OpenAI model", () => {
    const configured = createOpenAIModel({
      model: "gpt-4o-audio-preview",
      thinkingBudget: 0,
      apiKey: "google-key",
      openaiApiKey: "k",
    })
    expect(configured.modelId).toBe("gpt-4o-audio-preview")
    expect((configured.model as any).modelId).toBe("gpt-4o-audio-preview")
  })

  it("requires an OpenAI key", () => {
    expect(() =>
      createOpenAIModel({ model: "gpt-4o-audio-preview", thinkingBudget: 0, apiKey: "google-key" }),
    ).toThrow("OPENAI_API_KEY")
  })

  it("ignores the Gemini-only thinking budget", () => {
    const configured = createOpenAIModel({
      model: "gpt-4o-audio-preview",
      thinkingBudget: 1024,
      apiKey: "google-key",
      openaiApiKey: "k",
      options: { temperature: 0 },
    })
    expect(configured.providerOptions).toBeUndefined()
    expect(configured.callSettings).toEqual({ temperature: 0 })
  })
})
