import { describe, it, expect } from "bun:test"
import { GeminiProvider, createGeminiProvider } from "../../../src/ai/providers"

describe("GeminiProvider", () => {
  it("constructs with name and version", () => {
    const provider = new GeminiProvider({ model: "gemini-2.0-flash", apiKey: "test-key" })
    expect(provider.name).toBe("gemini")
    expect(provider.version).toBeDefined()
    expect(typeof provider.transcribe).toBe("function")
  })

  it("createGeminiProvider returns an ASRProvider", () => {
    const provider = createGeminiProvider({
      model: "gemini-2.0-flash",
      apiKey: "test-key",
      thinkingBudget: 512,
    })
    expect(provider.name).toBe("gemini")
    expect(typeof provider.transcribe).toBe("function")
  })
})
