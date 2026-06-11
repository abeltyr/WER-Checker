import { mkdir, writeFile, readFile } from "node:fs/promises"
import { dirname } from "node:path"

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(dirname(filePath))
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8")
}

export async function readJson<T = unknown>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8")
  return JSON.parse(raw) as T
}
