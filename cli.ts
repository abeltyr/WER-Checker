#!/usr/bin/env bun
import { stat } from "node:fs/promises"
import { Command } from "commander"
import chalk from "chalk"
import { loadConfig } from "./src/config"
import { parquetSource } from "./src/sources/parquet"
import { datasetSource } from "./src/sources/dataset"
import { runPipeline } from "./src/runner"
import { runExtraction } from "./src/extract"
import { runNormalize, cleaners } from "./src/normalize"
import { getAllModels, resolveModelSetup, loadProviderFile, PROVIDERS } from "./src/ai/models"
import type { Provider } from "./src/ai/models"
import { openResultsDb } from "./src/storage/db"
import type { DataSource } from "./src/sources/types"
import type { PipelineConfig } from "./src/runner"

/** A directory pattern means the normalized dataset layout; globs mean parquet. */
async function selectSource(pattern: string): Promise<DataSource> {
  try {
    if ((await stat(pattern)).isDirectory()) return datasetSource
  } catch {
    // pattern is a glob, not a path — fall through to parquet
  }
  return parquetSource
}

const program = new Command()

program
  .name("wer")
  .description("WER - Amharic ASR Evaluation Pipeline")
  .version("2.0.0")

// CLI flags override .env values; .env values override built-in defaults.
// Options therefore carry no commander defaults — fallbacks live in loadConfig.
program
  .command("run")
  .description("Run the ASR evaluation pipeline")
  .option("-m, --model <model>", "Model name (default: env MODEL_NAME, else the provider config's defaultModel)")
  .option("-P, --provider <provider>", `Provider whose config/defaultModel to use when -m is absent (${PROVIDERS.join("|")})`)
  .option("-t, --thinking-budget <budget>", "Thinking tokens budget (default: env THINKING_BUDGET or provider config)")
  .option("-s, --max-samples <number>", "Maximum samples to process (default: env MAX_SAMPLES or all)")
  .option("-c, --concurrency <number>", "Concurrency level (default: env CONCURRENCY or 3)")
  .option("--timeout <seconds>", "Per-request hard deadline in seconds (default: env REQUEST_TIMEOUT_SECONDS or 120)")
  .option("-p, --pattern <pattern>", "Data file pattern (default: env DATA_PATTERN or data/*/train-*.parquet)")
  .option("-o, --output <dir>", "Output directory (default: env OUTPUT_DIR or data/results)")
  .option("-r, --resume <runId>", "Resume from checkpoint")
  .option("--retest", "Re-test samples already evaluated with this model + thinking setting")
  .option("--api-key <key>", "API key (overrides env var)")
  .action(async (options) => {
    console.log(chalk.bold.cyan("=".repeat(50)))
    console.log(chalk.bold.cyan("  WER — Amharic ASR Evaluation Pipeline"))
    console.log(chalk.bold.cyan("=".repeat(50)))
    console.log()

    const envConfig = loadConfig({ requireApiKey: false })

    // Model + custom settings: CLI flags > explicit env > provider config file
    const setup = resolveModelSetup({
      model: options.model,
      provider: options.provider,
      thinkingBudget: options.thinkingBudget !== undefined ? parseInt(options.thinkingBudget, 10) : undefined,
      envModel: process.env.MODEL_NAME,
      envThinkingBudget: process.env.THINKING_BUDGET !== undefined
        ? parseInt(process.env.THINKING_BUDGET, 10)
        : undefined,
    })
    const { model, provider } = setup

    const config: PipelineConfig = {
      // --api-key applies to whichever provider the selected model belongs to
      geminiApiKey: (provider === "google" ? options.apiKey : undefined) ?? envConfig.geminiApiKey,
      openaiApiKey: (provider === "openai" ? options.apiKey : undefined) ?? envConfig.openaiApiKey,
      hasabApiKey: (provider === "hasab" ? options.apiKey : undefined) ?? envConfig.hasabApiKey,
      model,
      thinkingBudget: setup.thinkingBudget,
      modelOptions: Object.keys(setup.options).length > 0 ? setup.options : undefined,
      maxSamples: options.maxSamples !== undefined
        ? parseInt(options.maxSamples, 10)
        : envConfig.maxSamples,
      concurrency: options.concurrency !== undefined
        ? parseInt(options.concurrency, 10)
        : envConfig.concurrency,
      dataPattern: options.pattern ?? envConfig.dataPattern,
      outputDir: options.output ?? envConfig.outputDir,
      requestTimeoutMs: options.timeout !== undefined
        ? parseFloat(options.timeout) * 1000
        : envConfig.requestTimeoutMs,
      resume: options.resume,
      retest: options.retest ?? false,
    }

    if (provider === "google" && !config.geminiApiKey) {
      console.error(chalk.red(`Model "${model}" needs a Gemini key — set GEMINI_API_KEY in .env or pass --api-key`))
      process.exit(1)
    }
    if (provider === "openai" && !config.openaiApiKey) {
      console.error(chalk.red(`Model "${model}" needs an OpenAI key — set OPENAI_API_KEY in .env or pass --api-key`))
      process.exit(1)
    }
    if (provider === "hasab" && !config.hasabApiKey) {
      console.error(chalk.red(`Model "${model}" needs a Hasab key — set HASAB_API_KEY in .env or pass --api-key`))
      process.exit(1)
    }

    console.log(chalk.gray("Configuration:"))
    console.log(chalk.gray(`  model:          ${config.model} (${provider})`))
    console.log(chalk.gray(`  thinkingBudget: ${config.thinkingBudget}`))
    if (config.modelOptions) {
      console.log(chalk.gray(`  modelOptions:   ${JSON.stringify(config.modelOptions)}`))
    }
    console.log(chalk.gray(`  maxSamples:     ${config.maxSamples ?? "all"}`))
    console.log(chalk.gray(`  concurrency:    ${config.concurrency}`))
    console.log(chalk.gray(`  dataPattern:    ${config.dataPattern}`))
    console.log(chalk.gray(`  outputDir:      ${config.outputDir}`))
    console.log(chalk.gray(`  requestTimeout: ${(config.requestTimeoutMs ?? 120000) / 1000}s`))
    if (config.resume) {
      console.log(chalk.yellow(`  resume:         ${config.resume}`))
    }
    if (config.retest) {
      console.log(chalk.yellow(`  retest:         re-testing already-evaluated samples`))
    }
    console.log()

    const source = await selectSource(config.dataPattern)
    console.log(chalk.gray(`  source:         ${source.name}`))
    console.log()

    try {
      await runPipeline(config, source)
      console.log(chalk.green("\n✓ Pipeline completed successfully"))
      process.exit(0)
    } catch (err: unknown) {
      console.error(chalk.red("\n✗ Pipeline failed:"), err)
      process.exit(1)
    }
  })

program
  .command("extract")
  .description("Extract audio + transcripts from parquet files to disk (no AI calls)")
  .option("-p, --pattern <pattern>", "Data file pattern (default: env DATA_PATTERN or data/*/train-*.parquet)")
  .option("-o, --output <dir>", "Output directory", "data/extracted")
  .option("-s, --max-samples <number>", "Maximum samples to extract (default: all)")
  .option("--offset <number>", "Rows to skip at the start of each file")
  .option("--no-audio", "Skip writing WAV files (manifest.json only)")
  .action(async (options) => {
    console.log(chalk.bold.cyan("Extracting samples from parquet..."))
    console.log()

    const envConfig = loadConfig({ requireApiKey: false })

    try {
      const result = await runExtraction(
        {
          dataPattern: options.pattern ?? envConfig.dataPattern,
          outputDir: options.output,
          maxSamples: options.maxSamples !== undefined ? parseInt(options.maxSamples, 10) : undefined,
          offset: options.offset !== undefined ? parseInt(options.offset, 10) : undefined,
          audio: options.audio,
        },
        parquetSource,
      )

      console.log()
      console.log(chalk.green(`✓ Extracted ${result.count} sample(s) from ${result.files} file(s)`))
      console.log(chalk.green(`  manifest: ${result.manifestPath}`))
      if (options.audio) {
        console.log(chalk.green(`  audio:    ${options.output}/audio/`))
      }
      process.exit(0)
    } catch (err: unknown) {
      console.error(chalk.red("\n✗ Extraction failed:"), err)
      process.exit(1)
    }
  })

program
  .command("normalize")
  .description("Clean raw data into the canonical dataset layout (one folder per sample: <id>.wav + <id>.json)")
  .option("-i, --input <dir>", "Input directory", "data/extracted")
  .option("-o, --output <dir>", "Output dataset directory", "data/dataset")
  .option("--case <name>", `Cleanup case to apply (available: ${Object.keys(cleaners).join(", ")})`, "extracted")
  .option("-s, --max-samples <number>", "Maximum samples to write (default: all)")
  .action(async (options) => {
    console.log(chalk.bold.cyan("Normalizing data into canonical dataset..."))
    console.log()

    try {
      const result = await runNormalize({
        inputDir: options.input,
        outputDir: options.output,
        case: options.case,
        maxSamples: options.maxSamples !== undefined ? parseInt(options.maxSamples, 10) : undefined,
      })

      console.log()
      console.log(chalk.green(`✓ Wrote ${result.written} data point(s) to ${result.outputDir}`))
      if (result.skipped.length > 0) {
        console.log(chalk.yellow(`  skipped: ${result.skipped.length} (see warnings above)`))
      }
      process.exit(0)
    } catch (err: unknown) {
      console.error(chalk.red("\n✗ Normalization failed:"), err)
      process.exit(1)
    }
  })

program
  .command("validate")
  .description("Validate data sources")
  .option("-p, --pattern <pattern>", "Data file pattern", "data/*/train-*.parquet")
  .action(async (options) => {
    console.log(chalk.bold.cyan("Validating data sources..."))
    console.log()

    const pattern = options.pattern ?? "data/*/train-*.parquet"
    const source = await selectSource(pattern)
    const discovery = await source.discover(pattern)
    console.log(`Found ${discovery.files.length} file(s) (source: ${source.name})`)

    let allValid = true
    for (const file of discovery.files) {
      const result = await source.validate!(file)
      if (result.valid) {
        console.log(chalk.green(`  ✓ ${file}`))
      } else {
        allValid = false
        console.log(chalk.red(`  ✗ ${file}`))
        result.errors.forEach(err => console.log(chalk.red(`    - ${err}`)))
      }
    }
    process.exit(allValid ? 0 : 1)
  })

program
  .command("models")
  .description("List the configured transcription models, with pricing")
  .action(() => {
    console.log(chalk.bold.cyan("Transcription models (prices: USD per 1M tokens)"))
    console.log(chalk.gray("Configured in config/providers/<provider>.json — add models or custom options there."))
    console.log()
    const defaults: Partial<Record<Provider, string | undefined>> = {}
    for (const provider of PROVIDERS) {
      defaults[provider] = loadProviderFile(provider).defaultModel
    }
    const header = `${"model".padEnd(28)} ${"provider".padEnd(9)} ${"text-in".padStart(8)} ${"audio-in".padStart(9)} ${"out".padStart(8)}`
    console.log(chalk.gray(header))
    console.log(chalk.gray("-".repeat(header.length)))
    const price = (v: number | undefined) => (v === undefined ? "—" : "$" + v.toFixed(2))
    for (const m of getAllModels()) {
      const p = m.pricing
      const tags = [
        defaults[m.provider] === m.id ? chalk.cyan("(default)") : "",
        m.custom ? chalk.magenta("(custom)") : "",
      ].filter(Boolean).join(" ")
      console.log(
        `${m.id.padEnd(28)} ${m.provider.padEnd(9)} ${price(p?.inputPer1M).padStart(8)} ${price(p?.audioInputPer1M).padStart(9)} ${price(p?.outputPer1M).padStart(8)}  ${chalk.gray(m.description)} ${tags}`,
      )
      if (m.options) console.log(chalk.gray(`${"".padEnd(28)} options: ${JSON.stringify(m.options)}`))
      if (m.pricingNote) console.log(chalk.yellow(`${"".padEnd(28)} note: ${m.pricingNote}`))
    }
    console.log()
    console.log(chalk.gray("Run one with: bun run cli.ts run -m <model>   — or a provider's default: run -P openai"))
    console.log(chalk.gray("Already-tested samples are skipped per model+thinking combination."))
    process.exit(0)
  })

program
  .command("compare")
  .description("Cross-check models against each other from recorded results")
  .option("-o, --output <dir>", "Output directory holding results.db (default: env OUTPUT_DIR or data/results)")
  .option("-s, --sample <sampleId>", "Show every model's transcription of one sample")
  .action(async (options) => {
    const envConfig = loadConfig({ requireApiKey: false })
    const db = openResultsDb(options.output ?? envConfig.outputDir)

    try {
      if (options.sample) {
        const rows = db.getSampleCrossCheck(options.sample)
        if (rows.length === 0) {
          console.log(chalk.yellow(`No results recorded for sample ${options.sample}`))
          process.exit(0)
        }
        console.log(chalk.bold.cyan(`Cross-check for ${options.sample}`))
        console.log()
        console.log(chalk.gray(`reference: ${rows[0]!.referenceText}`))
        for (const r of rows) {
          console.log()
          const cost = r.costUsd !== undefined && r.costUsd !== null ? ` | $${r.costUsd.toFixed(6)}` : ""
          console.log(chalk.bold(`${r.model} (thinking ${r.thinkingBudget})`) +
            chalk.gray(` — WER ${(r.wer * 100).toFixed(1)}% | CER ${(r.cer * 100).toFixed(1)}% | ${r.latencyMs}ms${cost}`))
          console.log(`  ${r.success ? r.hypothesisText || chalk.gray("(empty)") : chalk.red("FAILED")}`)
        }
        process.exit(0)
      }

      const rows = db.getModelComparison()
      if (rows.length === 0) {
        console.log(chalk.yellow("No results recorded yet — run the pipeline first"))
        process.exit(0)
      }
      console.log(chalk.bold.cyan("Model comparison (latest attempt per sample)"))
      console.log()
      const header = `${"model".padEnd(28)} ${"think".padStart(6)} ${"samples".padStart(8)} ${"ok".padStart(5)} ${"avgWER".padStart(8)} ${"avgCER".padStart(8)} ${"avg ms".padStart(8)} ${"in-tok".padStart(9)} ${"out-tok".padStart(9)} ${"cost".padStart(10)}`
      console.log(chalk.gray(header))
      console.log(chalk.gray("-".repeat(header.length)))
      for (const r of rows) {
        const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`)
        console.log(
          `${r.model.padEnd(28)} ${String(r.thinkingBudget).padStart(6)} ${String(r.samples).padStart(8)} ${String(r.successful).padStart(5)} ` +
          `${pct(r.avgWer).padStart(8)} ${pct(r.avgCer).padStart(8)} ${String(r.avgLatencyMs === null ? "—" : Math.round(r.avgLatencyMs)).padStart(8)} ` +
          `${String(r.inputTokens).padStart(9)} ${String(r.outputTokens).padStart(9)} ${(r.costUsd === null ? "—" : "$" + r.costUsd.toFixed(4)).padStart(10)}`,
        )
      }
      console.log()
      console.log(chalk.gray("Per-sample cross-check: bun run cli.ts compare -s <sampleId>"))
      process.exit(0)
    } finally {
      db.close()
    }
  })

program
  .command("info")
  .description("Show system information")
  .action(() => {
    console.log(chalk.bold.cyan("System Information"))
    console.log()
    console.log(`  Platform:    ${process.platform}`)
    console.log(`  Arch:        ${process.arch}`)
    console.log(`  Node:        ${process.version}`)
    console.log(`  Bun:         ${Bun.version}`)
    console.log(`  Memory:      ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB RSS`)
    console.log()
  })

program.parse()
