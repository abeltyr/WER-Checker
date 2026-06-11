export interface MemoryUsage {
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
  rss: number
}

export interface MemoryWarningThresholds {
  heapUsedMB?: number
  heapTotalMB?: number
  rssMB?: number
}

const DEFAULT_THRESHOLDS: MemoryWarningThresholds = {
  heapUsedMB: 500,
  heapTotalMB: 1000,
  rssMB: 1500,
}

export function getMemoryUsage(): MemoryUsage {
  const mem = process.memoryUsage()
  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
    rss: mem.rss,
  }
}

export function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024
  return `${mb.toFixed(2)} MB`
}

export function checkMemoryThresholds(
  thresholds: MemoryWarningThresholds = DEFAULT_THRESHOLDS
): { ok: boolean; warnings: string[] } {
  const mem = getMemoryUsage()
  const warnings: string[] = []

  if (thresholds.heapUsedMB && mem.heapUsed > thresholds.heapUsedMB * 1024 * 1024) {
    warnings.push(`Heap used (${formatBytes(mem.heapUsed)}) exceeds threshold (${thresholds.heapUsedMB} MB)`)
  }

  if (thresholds.heapTotalMB && mem.heapTotal > thresholds.heapTotalMB * 1024 * 1024) {
    warnings.push(`Heap total (${formatBytes(mem.heapTotal)}) exceeds threshold (${thresholds.heapTotalMB} MB)`)
  }

  if (thresholds.rssMB && mem.rss > thresholds.rssMB * 1024 * 1024) {
    warnings.push(`RSS (${formatBytes(mem.rss)}) exceeds threshold (${thresholds.rssMB} MB)`)
  }

  return {
    ok: warnings.length === 0,
    warnings,
  }
}

export async function forceGarbageCollection(): Promise<void> {
  if (global.gc) {
    global.gc()
  }
}

export function logMemoryUsage(prefix: string = ""): void {
  const mem = getMemoryUsage()
  console.log(
    `${prefix ? prefix + " " : ""}Memory: ` +
    `Heap ${formatBytes(mem.heapUsed)}/${formatBytes(mem.heapTotal)}, ` +
    `RSS ${formatBytes(mem.rss)}, ` +
    `External ${formatBytes(mem.external)}`
  )
}

export class MemoryMonitor {
  private interval?: ReturnType<typeof setInterval>
  private thresholds: MemoryWarningThresholds

  constructor(thresholds?: MemoryWarningThresholds) {
    this.thresholds = thresholds ?? DEFAULT_THRESHOLDS
  }

  start(intervalMs: number = 10000): void {
    this.interval = setInterval(() => {
      const { ok, warnings } = checkMemoryThresholds(this.thresholds)
      if (!ok) {
        console.warn("[memory] Thresholds exceeded:", warnings.join("; "))
      }
      logMemoryUsage("[memory]")
    }, intervalMs)
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = undefined
    }
  }
}

export function estimateAudioBufferSize(samples: number, avgDurationSeconds: number = 10): number {
  const avgBytes = avgDurationSeconds * 8000 * 2
  return samples * avgBytes
}
