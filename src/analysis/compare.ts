import type { TextDimension } from "../core/types"

/**
 * Compute every text metric (WER, CER, MER, WIL, BLEU) in a single pass:
 * one tokenisation and one word-level Levenshtein alignment shared by all
 * word-based metrics, plus one character-level pass for CER.
 */
export function computeTextDimension(reference: string, hypothesis: string): TextDimension {
  const refWords = tokenise(reference)
  const hypWords = tokenise(hypothesis)

  const { substitutions, deletions, insertions } = levenshteinWords(refWords, hypWords)
  const errors = substitutions + deletions + insertions
  const hits = refWords.length - substitutions - deletions

  return {
    referenceText: reference,
    hypothesisText: hypothesis,
    wordCount: { reference: refWords.length, hypothesis: hypWords.length },
    errors: { substitutions, deletions, insertions, total: errors },
    wer: refWords.length > 0 ? errors / refWords.length : 0,
    cer: computeCer(reference, hypothesis),
    mer: merFromCounts(hits, errors),
    wil: wilFromCounts(hits, refWords.length, hypWords.length),
    bleu: bleuFromTokens(refWords, hypWords),
  }
}

function tokenise(text: string): string[] {
  return text
    .replace(/[፠-፨]/g, " ") // Ethiopic punctuation acts as a separator
    .replace(/[^\w\sሀ-፿]/g, "")
    .split(/\s+/)
    .filter(Boolean)
}

/** MER = E / (H + E) where H = hits, E = S + D + I. */
function merFromCounts(hits: number, errors: number): number {
  const denominator = hits + errors
  return denominator > 0 ? errors / denominator : 0
}

/** WIL = 1 − H²/(N1·N2) where N1/N2 are reference/hypothesis word counts. */
function wilFromCounts(hits: number, refLen: number, hypLen: number): number {
  if (refLen === 0 && hypLen === 0) return 0
  if (refLen === 0 || hypLen === 0) return 1
  return 1 - (hits * hits) / (refLen * hypLen)
}

function bleuFromTokens(refWords: string[], hypWords: string[], maxN: number = 4): number {
  if (refWords.length === 0 || hypWords.length === 0) return 0

  // Use only the n-gram orders both texts can support, weighted evenly.
  const effectiveN = Math.min(maxN, refWords.length, hypWords.length)
  let logPrecisionSum = 0
  for (let n = 1; n <= effectiveN; n++) {
    const matches = countNgramMatches(refWords, hypWords, n)
    if (matches === 0) return 0
    logPrecisionSum += Math.log(matches / (hypWords.length - n + 1)) / effectiveN
  }

  const brevityPenalty = hypWords.length < refWords.length
    ? Math.exp(1 - refWords.length / hypWords.length)
    : 1.0

  return Math.exp(logPrecisionSum) * brevityPenalty
}

export function computeMER(ref: string, hyp: string): number {
  const refWords = tokenise(ref)
  const hypWords = tokenise(hyp)
  const d = levenshteinWords(refWords, hypWords)
  const errors = d.substitutions + d.deletions + d.insertions
  return merFromCounts(refWords.length - d.substitutions - d.deletions, errors)
}

export function computeWIL(ref: string, hyp: string): number {
  const refWords = tokenise(ref)
  const hypWords = tokenise(hyp)
  const d = levenshteinWords(refWords, hypWords)
  return wilFromCounts(refWords.length - d.substitutions - d.deletions, refWords.length, hypWords.length)
}

export function computeBLEU(ref: string, hyp: string, maxN: number = 4): number {
  return bleuFromTokens(tokenise(ref), tokenise(hyp), maxN)
}

function countNgramMatches(ref: string[], hyp: string[], n: number): number {
  const refNgrams = new Map<string, number>()
  for (let i = 0; i <= ref.length - n; i++) {
    const ngram = ref.slice(i, i + n).join(" ")
    refNgrams.set(ngram, (refNgrams.get(ngram) ?? 0) + 1)
  }

  let matches = 0
  const hypNgrams = new Map<string, number>()
  for (let i = 0; i <= hyp.length - n; i++) {
    const ngram = hyp.slice(i, i + n).join(" ")
    hypNgrams.set(ngram, (hypNgrams.get(ngram) ?? 0) + 1)
  }

  for (const [ngram, count] of hypNgrams) {
    const refCount = refNgrams.get(ngram) ?? 0
    matches += Math.min(count, refCount)
  }

  return matches
}

/** Levenshtein distance returning the edit operation counts. */
function levenshteinWords(ref: string[], hyp: string[]) {
  const rows = ref.length + 1
  const cols = hyp.length + 1

  const d: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0))
  for (let i = 0; i < rows; i++) d[i]![0] = i
  for (let j = 0; j < cols; j++) d[0]![j] = j

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + cost,
      )
    }
  }

  // Backtrack to count operations
  let substitutions = 0
  let deletions = 0
  let insertions = 0
  let i = ref.length
  let j = hyp.length

  while (i > 0 || j > 0) {
    if (i > 0 && d[i]![j] === d[i - 1]![j]! + 1) {
      deletions++
      i--
    } else if (j > 0 && d[i]![j] === d[i]![j - 1]! + 1) {
      insertions++
      j--
    } else {
      if (ref[i - 1] !== hyp[j - 1]) substitutions++
      i--
      j--
    }
  }

  return { substitutions, deletions, insertions }
}

/** Character Error Rate — character-level Levenshtein with O(min) rolling rows. */
function computeCer(ref: string, hyp: string): number {
  const r = [...ref]
  const h = [...hyp]

  let prev: number[] = Array.from({ length: h.length + 1 }, (_, j) => j)
  let curr: number[] = new Array(h.length + 1).fill(0)

  for (let i = 1; i <= r.length; i++) {
    curr[0] = i
    for (let j = 1; j <= h.length; j++) {
      const cost = r[i - 1] === h[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost)
    }
    ;[prev, curr] = [curr, prev]
  }

  return prev[h.length]! / Math.max(r.length, 1)
}
