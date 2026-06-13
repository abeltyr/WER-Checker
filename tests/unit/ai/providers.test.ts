import { describe, it, expect } from "bun:test"
import { createGoogleModel, createOpenAIModel, createHasabModel } from "../../../src/ai/providers"
import { makeSample } from "../../helpers"

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

describe("createHasabModel", () => {
  it("requires a Hasab key", () => {
    expect(() => createHasabModel({ model: "hasab-asr", thinkingBudget: 0, apiKey: "" }))
      .toThrow("HASAB_API_KEY")
  })

  it("exposes a transcribe function rather than an AI-SDK language model", () => {
    const configured = createHasabModel({ model: "hasab-asr", thinkingBudget: 0, apiKey: "", hasabApiKey: "h" })
    expect(configured.modelId).toBe("hasab-asr")
    expect(typeof configured.transcribe).toBe("function")
    expect(configured.model).toBeUndefined()
  })

  it("POSTs the audio to Hasab with bearer auth and returns the transcription", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({ transcription: "ሰላም አለም", tokens_used: 12, success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch
    try {
      const configured = createHasabModel({ model: "hasab-asr", thinkingBudget: 0, apiKey: "", hasabApiKey: "secret" })
      const result = await configured.transcribe!(makeSample(), AbortSignal.timeout(5000))
      expect(result.transcription).toBe("ሰላም አለም")
      expect(result.tokensUsed).toBe(12)
      expect(calls).toHaveLength(1)
      expect(calls[0]!.url).toContain("/upload-audio")
      expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer secret")
    } finally {
      globalThis.fetch = original
    }
  })

  it("throws on a non-2xx Hasab response so the call is retried", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch
    try {
      const configured = createHasabModel({ model: "hasab-asr", thinkingBudget: 0, apiKey: "", hasabApiKey: "secret" })
      await expect(configured.transcribe!(makeSample(), AbortSignal.timeout(5000))).rejects.toThrow("429")
    } finally {
      globalThis.fetch = original
    }
  })
})
