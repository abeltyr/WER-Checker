import { Glob } from "bun"
import { resolve } from "node:path"

export async function discoverParquetFiles(pattern: string): Promise<string[]> {
  const glob = new Glob(pattern)
  const cwd = resolve(".")
  const paths: string[] = []

  try {
    for await (const match of glob.scan({ cwd, absolute: true })) {
      paths.push(match)
    }
  } catch (err) {
    // A pattern whose base directory doesn't exist means no matches, not a crash
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err
  }

  return paths.sort()
}
