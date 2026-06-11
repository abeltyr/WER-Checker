export interface DecodedWav {
  sampleRate: number
  durationSeconds: number
}

/**
 * Parse a WAV byte buffer to extract sample rate and duration.
 * The audio column in the parquet is `Struct<bytes: Binary, path: Utf8>`
 * where `bytes` is a complete WAV file.
 */
export function decodeWavBytes(buf: Buffer): DecodedWav | null {
  const header = buf.subarray(0, 4).toString()
  if (header !== "RIFF") return null

  const sampleRate = buf.readUInt32LE(24)
  const bitsPerSample = buf.readUInt16LE(34)
  const channels = buf.readUInt16LE(22)
  const dataLen = buf.readUInt32LE(40)

  const bytesPerSec = (sampleRate * channels * bitsPerSample) / 8
  const durationSeconds = bytesPerSec > 0 ? dataLen / (sampleRate * channels * (bitsPerSample / 8)) : 0

  return { sampleRate, durationSeconds }
}
