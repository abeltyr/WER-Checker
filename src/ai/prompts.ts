import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

export interface LoadedPrompts {
  system: string
  user: string
}

interface PromptTemplates {
  system: string
  user: string
}

// The template files never change during a run — read them exactly once.
let templatesPromise: Promise<PromptTemplates> | null = null

function loadTemplates(): Promise<PromptTemplates> {
  templatesPromise ??= (async () => {
    const base = resolve("prompt")
    const [systemRaw, userRaw] = await Promise.all([
      readFile(resolve(base, "system.md"), "utf-8"),
      readFile(resolve(base, "prompt.md"), "utf-8"),
    ])
    return { system: systemRaw.trim(), user: userRaw }
  })()
  return templatesPromise
}

/**
 * Render the prompt pair for a clip, interpolating the {{duration}}
 * placeholder in the user prompt with the actual clip length.
 */
export async function loadPrompts(durationSeconds: number): Promise<LoadedPrompts> {
  const templates = await loadTemplates()
  const durationStr = durationSeconds.toFixed(1)

  return {
    system: templates.system,
    user: templates.user.replaceAll(/\$\{durationStr\}/g, durationStr).trim(),
  }
}
