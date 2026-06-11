import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Sample, AiResult, GeminiOutput, RunConfig } from "../src/core/types"

export async function makeTmpDir(prefix = "wer-test-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

export interface WavOptions {
  sampleRate?: number
  channels?: number
  bitsPerSample?: number
  numSamples?: number
}

/** Build a complete, valid WAV file with a canonical 44-byte header. */
export function makeWav(options: WavOptions = {}): Buffer {
  const sampleRate = options.sampleRate ?? 8000
  const channels = options.channels ?? 1
  const bitsPerSample = options.bitsPerSample ?? 16
  const numSamples = options.numSamples ?? sampleRate // 1 second by default

  const bytesPerSample = bitsPerSample / 8
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataLen = numSamples * blockAlign

  const buf = Buffer.alloc(44 + dataLen)
  buf.write("RIFF", 0)
  buf.writeUInt32LE(36 + dataLen, 4)
  buf.write("WAVE", 8)
  buf.write("fmt ", 12)
  buf.writeUInt32LE(16, 16) // fmt chunk size
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(byteRate, 28)
  buf.writeUInt16LE(blockAlign, 32)
  buf.writeUInt16LE(bitsPerSample, 34)
  buf.write("data", 36)
  buf.writeUInt32LE(dataLen, 40)
  // sample data stays zeroed (silence)
  return buf
}

export function makeSample(overrides: Partial<Sample> = {}): Sample {
  const audioBuffer = overrides.audioBuffer ?? makeWav()
  return {
    id: "gonder_row_0000",
    source: "test",
    sourceFile: "/test/fixture.parquet",
    rowIndex: 0,
    dialect: "gonder",
    audioBuffer,
    audioMimeType: "audio/wav",
    durationSeconds: 1,
    sampleRate: 8000,
    metadata: {
      text: "ሰላም አለም",
      dialect: "gonder",
      speaker_id: "SPK1",
      gender: "female",
    },
    ...overrides,
  }
}

export function makeGeminiOutput(
  transcription: string,
  overrides: Partial<GeminiOutput> = {},
): GeminiOutput {
  return {
    transcription,
    gender: "female",
    dialect: "gonder",
    speaker_count: 1,
    ...overrides,
  }
}

export function makeAiResult(overrides: Partial<AiResult> = {}): AiResult {
  return {
    sampleId: "gonder_row_0000",
    success: true,
    latencyMs: 100,
    tokenUsage: { input: 10, output: 5, total: 15 },
    modelVersion: "test-model",
    rawResponse: "{}",
    parsedResponse: makeGeminiOutput("ሰላም አለም"),
    ...overrides,
  }
}

export function makeRunConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    model: "test-model",
    thinkingBudget: 0,
    concurrency: 1,
    dataPattern: "data/*/train-*.parquet",
    outputDir: "data/results",
    ...overrides,
  }
}
