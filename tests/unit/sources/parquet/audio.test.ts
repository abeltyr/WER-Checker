import { describe, it, expect } from "bun:test"
import { decodeWavBytes } from "../../../../src/sources/parquet/audio"
import { makeWav } from "../../../helpers"

describe("decodeWavBytes", () => {
  it("decodes sample rate and duration from a 16-bit mono WAV", () => {
    const wav = makeWav({ sampleRate: 8000, bitsPerSample: 16, channels: 1, numSamples: 16000 })
    const decoded = decodeWavBytes(wav)

    expect(decoded).not.toBeNull()
    expect(decoded!.sampleRate).toBe(8000)
    expect(decoded!.durationSeconds).toBeCloseTo(2, 5)
  })

  it("decodes an 8-bit mono WAV (telephone audio)", () => {
    const wav = makeWav({ sampleRate: 8000, bitsPerSample: 8, channels: 1, numSamples: 8000 })
    const decoded = decodeWavBytes(wav)

    expect(decoded!.sampleRate).toBe(8000)
    expect(decoded!.durationSeconds).toBeCloseTo(1, 5)
  })

  it("decodes a stereo 44.1kHz WAV", () => {
    const wav = makeWav({ sampleRate: 44100, bitsPerSample: 16, channels: 2, numSamples: 44100 })
    const decoded = decodeWavBytes(wav)

    expect(decoded!.sampleRate).toBe(44100)
    expect(decoded!.durationSeconds).toBeCloseTo(1, 5)
  })

  it("returns null for non-RIFF data", () => {
    expect(decodeWavBytes(Buffer.from("not a wav file at all, just text padding"))).toBeNull()
  })

  it("returns zero duration when the format fields are zeroed", () => {
    const wav = makeWav()
    wav.writeUInt16LE(0, 34) // bitsPerSample = 0
    const decoded = decodeWavBytes(wav)
    expect(decoded!.durationSeconds).toBe(0)
  })
})
