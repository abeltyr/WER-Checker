import { z } from "zod"
import type { RunConfig } from "../core/types"

// .env.example ships `KEY=` lines — an empty string must mean "not set"
const optionalKey = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().optional(),
)

const envSchema = z.object({
  GEMINI_API_KEY: optionalKey,
  GOOGLE_GENERATIVE_AI_API_KEY: optionalKey,
  OPENAI_API_KEY: optionalKey,
  MODEL_NAME: z.string().default("gemini-2.0-flash"),
  THINKING_BUDGET: z.coerce.number().int().min(0).default(0),
  DATA_PATTERN: z.string().default("data/*/train-*.parquet"),
  MAX_SAMPLES: z.coerce.number().int().positive().optional(),
  CONCURRENCY: z.coerce.number().int().positive().default(3),
  OUTPUT_DIR: z.string().default("data/results"),
  REQUEST_TIMEOUT_SECONDS: z.coerce.number().positive().default(120),
})

type Env = z.infer<typeof envSchema>

export function loadConfig(
  options?: { requireApiKey?: boolean },
): RunConfig & { geminiApiKey: string; openaiApiKey?: string } {
  const requireApiKey = options?.requireApiKey ?? true

  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    console.error("Invalid environment variables:")
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`)
    }
    process.exit(1)
  }

  const env: Env = result.data
  const geminiApiKey = env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GEMINI_API_KEY

  if (!geminiApiKey && requireApiKey) {
    console.error("Missing API key. Set GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY in .env")
    process.exit(1)
  }

  return {
    geminiApiKey: geminiApiKey ?? "",
    openaiApiKey: env.OPENAI_API_KEY,
    model: env.MODEL_NAME,
    thinkingBudget: env.THINKING_BUDGET,
    maxSamples: env.MAX_SAMPLES,
    concurrency: env.CONCURRENCY,
    dataPattern: env.DATA_PATTERN,
    outputDir: env.OUTPUT_DIR,
    requestTimeoutMs: env.REQUEST_TIMEOUT_SECONDS * 1000,
  }
}
