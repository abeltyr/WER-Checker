import { describe, it, expect } from "bun:test"
import { join } from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import {
  getAllModels,
  getModelInfo,
  resolveModelSetup,
  loadProviderFile,
  estimateCostUsd,
} from "../../../src/ai/models"
import { makeTmpDir } from "../../helpers"

async function makeConfigDir(files: Record<string, unknown>): Promise<string> {
  const dir = await makeTmpDir("wer-providers-")
  await mkdir(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), typeof content === "string" ? content : JSON.stringify(content))
  }
  return dir
}

describe("provider config files", () => {
  it("falls back to built-ins when no config files exist", async () => {
    const dir = await makeTmpDir("wer-providers-empty-")
    const models = getAllModels(dir)
    expect(models.find((m) => m.id === "gemini-2.0-flash")).toBeDefined()
    expect(models.find((m) => m.id === "gpt-4o-audio-preview")).toBeDefined()
    expect(loadProviderFile("google", dir)).toEqual({})
  })

  it("adds custom models from the config file", async () => {
    const dir = await makeConfigDir({
      "google.json": {
        models: {
          "gemini-9-custom": {
            description: "internal finetune",
            pricing: { inputPer1M: 1, audioInputPer1M: 2, outputPer1M: 3 },
          },
        },
      },
    })

    const custom = getModelInfo("gemini-9-custom", dir)!
    expect(custom.provider).toBe("google")
    expect(custom.custom).toBe(true)
    expect(custom.description).toBe("internal finetune")
    // cost estimation works for config-file models too
    expect(estimateCostUsd("gemini-9-custom", { inputTokens: 1_000_000, outputTokens: 0 }, dir)).toBe(2)
  })

  it("overrides built-in pricing per model", async () => {
    const dir = await makeConfigDir({
      "google.json": {
        models: {
          "gemini-2.0-flash": { pricing: { inputPer1M: 9, audioInputPer1M: 9, outputPer1M: 9 } },
        },
      },
    })

    expect(getModelInfo("gemini-2.0-flash", dir)!.pricing!.audioInputPer1M).toBe(9)
    // other built-ins keep their prices
    expect(getModelInfo("gemini-2.5-pro", dir)!.pricing!.outputPer1M).toBe(10)
  })

  it("rejects a custom model without pricing and malformed files", async () => {
    const noPricing = await makeConfigDir({ "google.json": { models: { mystery: {} } } })
    expect(() => getAllModels(noPricing)).toThrow('custom model "mystery" needs a pricing block')

    const malformed = await makeConfigDir({ "openai.json": '{ "defaultModel": 42 }' })
    expect(() => loadProviderFile("openai", malformed)).toThrow("Invalid provider config")
  })
})

describe("resolveModelSetup", () => {
  it("CLI model wins over env and config defaults", async () => {
    const dir = await makeConfigDir({ "google.json": { defaultModel: "gemini-2.5-pro" } })
    const setup = resolveModelSetup({ model: "gemini-2.0-flash", envModel: "gemini-2.5-flash", baseDir: dir })
    expect(setup.model).toBe("gemini-2.0-flash")
  })

  it("uses the selected provider's defaultModel when no model is given", async () => {
    const dir = await makeConfigDir({
      "google.json": { defaultModel: "gemini-2.5-flash" },
      "openai.json": { defaultModel: "gpt-4o-mini-audio-preview" },
    })

    expect(resolveModelSetup({ baseDir: dir }).model).toBe("gemini-2.5-flash")
    const openai = resolveModelSetup({ provider: "openai", baseDir: dir })
    expect(openai.model).toBe("gpt-4o-mini-audio-preview")
    expect(openai.provider).toBe("openai")
  })

  it("an explicit provider flag outranks the ambient env model", async () => {
    const dir = await makeConfigDir({
      "openai.json": { defaultModel: "gpt-4o-mini-audio-preview" },
    })
    const setup = resolveModelSetup({
      provider: "openai",
      envModel: "gemini-3-flash-preview",
      baseDir: dir,
    })
    expect(setup.model).toBe("gpt-4o-mini-audio-preview")
  })

  it("falls back to the provider's first built-in when its file has no defaultModel", async () => {
    const dir = await makeTmpDir("wer-providers-nodefault-")
    const setup = resolveModelSetup({ provider: "openai", envModel: "gemini-2.0-flash", baseDir: dir })
    expect(setup.provider).toBe("openai")
    expect(setup.model).toBe("gpt-4o-audio-preview")
  })

  it("rejects unknown providers", () => {
    expect(() => resolveModelSetup({ provider: "anthropic" })).toThrow('Unknown provider "anthropic"')
  })

  it("resolves thinking budget: CLI > env > model options > provider options", async () => {
    const dir = await makeConfigDir({
      "google.json": {
        options: { thinkingBudget: 128 },
        models: { "gemini-2.5-flash": { options: { thinkingBudget: 512 } } },
      },
    })

    const base = { model: "gemini-2.5-flash", baseDir: dir }
    expect(resolveModelSetup({ ...base, thinkingBudget: 9 }).thinkingBudget).toBe(9)
    expect(resolveModelSetup({ ...base, envThinkingBudget: 7 }).thinkingBudget).toBe(7)
    expect(resolveModelSetup(base).thinkingBudget).toBe(512)
    expect(resolveModelSetup({ model: "gemini-2.0-flash", baseDir: dir }).thinkingBudget).toBe(128)
  })

  it("merges provider-wide and per-model options, model winning", async () => {
    const dir = await makeConfigDir({
      "google.json": {
        options: { temperature: 0, topP: 0.9, providerOptions: { google: { a: 1 } } },
        models: {
          "gemini-2.0-flash": {
            options: { temperature: 0.3, providerOptions: { google: { b: 2 } } },
          },
        },
      },
    })

    const setup = resolveModelSetup({ model: "gemini-2.0-flash", baseDir: dir })
    expect(setup.options.temperature).toBe(0.3) // model beats provider
    expect(setup.options.topP).toBe(0.9) // provider-wide inherited
    expect(setup.options.providerOptions).toEqual({ google: { b: 2 } })
    expect(setup.thinkingBudget).toBe(0)
  })
})
