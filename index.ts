import { stat } from "node:fs/promises"
import { loadConfig } from "./src/config"
import { resolveModelSetup } from "./src/ai/models"
import { parquetSource } from "./src/sources/parquet"
import { datasetSource } from "./src/sources/dataset"
import { runPipeline } from "./src/runner"
import type { PipelineConfig } from "./src/runner"

async function main() {
  console.log("=".repeat(50))
  console.log("  WER — Amharic ASR Evaluation Pipeline")
  console.log("=".repeat(50))

  // Explicit env > provider config file defaults
  const setup = resolveModelSetup({
    envModel: process.env.MODEL_NAME,
    envThinkingBudget: process.env.THINKING_BUDGET !== undefined
      ? parseInt(process.env.THINKING_BUDGET, 10)
      : undefined,
  })

  const config: PipelineConfig = {
    ...loadConfig(),
    model: setup.model,
    thinkingBudget: setup.thinkingBudget,
    modelOptions: Object.keys(setup.options).length > 0 ? setup.options : undefined,
  }
  console.log(`  model:          ${config.model}`)
  console.log(`  thinkingBudget: ${config.thinkingBudget}`)
  console.log(`  maxSamples:     ${config.maxSamples ?? "all"}`)
  console.log(`  concurrency:    ${config.concurrency}`)
  console.log(`  dataPattern:    ${config.dataPattern}`)
  console.log(`  outputDir:      ${config.outputDir}`)
  console.log("")

  // A directory pattern means the normalized dataset layout; globs mean parquet.
  const source = await stat(config.dataPattern).then(s => s.isDirectory()).catch(() => false)
    ? datasetSource
    : parquetSource
  console.log(`  source:         ${source.name}`)

  await runPipeline(config, source)
}

main()
  .then(() => {
    // Explicit exit: the duckdb native module segfaults Bun during implicit
    // process teardown, so never let the runtime exit on its own.
    process.exit(0)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
