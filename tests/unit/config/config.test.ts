import { describe, it, expect, beforeEach, afterAll, spyOn } from "bun:test"
import { loadConfig } from "../../../src/config"

const ENV_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "MODEL_NAME",
  "THINKING_BUDGET",
  "DATA_PATTERN",
  "MAX_SAMPLES",
  "CONCURRENCY",
  "OUTPUT_DIR",
] as const

const savedEnv: Record<string, string | undefined> = {}
for (const key of ENV_KEYS) savedEnv[key] = process.env[key]

beforeEach(() => {
  // bun auto-loads .env, so clear everything for isolation
  for (const key of ENV_KEYS) delete process.env[key]
})

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe("loadConfig", () => {
  it("applies defaults when only the API key is set", () => {
    process.env.GEMINI_API_KEY = "test-key"
    const config = loadConfig()

    expect(config.geminiApiKey).toBe("test-key")
    expect(config.model).toBe("gemini-2.0-flash")
    expect(config.thinkingBudget).toBe(0)
    expect(config.maxSamples).toBeUndefined()
    expect(config.concurrency).toBe(3)
    expect(config.dataPattern).toBe("data/*/train-*.parquet")
    expect(config.outputDir).toBe("data/results")
  })

  it("coerces numeric env vars", () => {
    process.env.GEMINI_API_KEY = "test-key"
    process.env.THINKING_BUDGET = "2048"
    process.env.MAX_SAMPLES = "25"
    process.env.CONCURRENCY = "7"

    const config = loadConfig()
    expect(config.thinkingBudget).toBe(2048)
    expect(config.maxSamples).toBe(25)
    expect(config.concurrency).toBe(7)
  })

  it("prefers GOOGLE_GENERATIVE_AI_API_KEY over GEMINI_API_KEY", () => {
    process.env.GEMINI_API_KEY = "gemini-key"
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "google-key"
    expect(loadConfig().geminiApiKey).toBe("google-key")
  })

  it("returns an empty key when requireApiKey is false and no key is set", () => {
    const config = loadConfig({ requireApiKey: false })
    expect(config.geminiApiKey).toBe("")
  })

  it("exits when no API key is set and requireApiKey is default", () => {
    const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never)
    const errorSpy = spyOn(console, "error").mockImplementation(() => {})

    try {
      expect(() => loadConfig()).toThrow("process.exit(1)")
    } finally {
      exitSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })

  it("exits on invalid numeric env vars", () => {
    process.env.GEMINI_API_KEY = "test-key"
    process.env.CONCURRENCY = "not-a-number"

    const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never)
    const errorSpy = spyOn(console, "error").mockImplementation(() => {})

    try {
      expect(() => loadConfig()).toThrow("process.exit(1)")
    } finally {
      exitSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })
})
