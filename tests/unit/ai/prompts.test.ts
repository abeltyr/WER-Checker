import { describe, it, expect } from "bun:test"
import { loadPrompts } from "../../../src/ai/prompts"

describe("loadPrompts", () => {
  it("loads non-empty system and user prompts", async () => {
    const prompts = await loadPrompts(10)
    expect(prompts.system.length).toBeGreaterThan(0)
    expect(prompts.user.length).toBeGreaterThan(0)
  })

  it("interpolates the duration placeholder with one decimal place", async () => {
    const prompts = await loadPrompts(12.345)
    expect(prompts.user).toContain("12.3")
    expect(prompts.user).not.toContain("${durationStr}")
  })

  it("replaces every occurrence of the placeholder", async () => {
    const prompts = await loadPrompts(7)
    expect(prompts.user).not.toContain("${durationStr}")
    // the prompt template references the duration several times
    expect(prompts.user.split("7.0").length).toBeGreaterThan(2)
  })

  it("trims surrounding whitespace", async () => {
    const prompts = await loadPrompts(5)
    expect(prompts.system).toBe(prompts.system.trim())
    expect(prompts.user).toBe(prompts.user.trim())
  })
})
