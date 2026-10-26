/**
 * Cost estimation from the token counts already captured during indexing.
 *
 * Prices are *seeded*, not baked in. Published rates change and promotional
 * rates expire, so every number here is a dated default the user can overwrite
 * in the UI; the DB row always wins. `PRICES_AS_OF` is shown next to the total
 * so a stale table is visible rather than silently wrong.
 */

export type ModelPrice = {
  model: string
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok: number
  /** Cache writes with the 5-minute TTL. */
  cacheWritePerMTok: number
  /** Cache writes with the 1-hour TTL (Claude Code uses both). */
  cacheWrite1hPerMTok: number
}

/** The date of Anthropic's published pricing the `claude-*` rows below were taken from. */
export const PRICES_AS_OF = '2026-10-06'

/** The date of OpenAI's published pricing (developers.openai.com) the `gpt-*` rows were taken from. */
export const OPENAI_PRICES_AS_OF = '2026-10-27'

/**
 * Bumped whenever DEFAULT_PRICES gains models. On a bump, models missing from the
 * user's table are added once; existing rows (and so user edits) are never touched.
 */
export const PRICES_SEED_VERSION = 3

/**
 * Keys are matched as prefixes against the `model` string recorded in the
 * transcript, so `claude-sonnet-4-5-20250929` resolves via `claude-sonnet-4-5`.
 *
 * Cache writes follow the published ratios — 1.25x input for the 5-minute TTL and
 * 2x for the 1-hour TTL. Cache reads are 0.1x input on most models but differ on
 * some (Claude Opus 5.5: $0.20, Claude Fable 5.1: $0.25), so the read rate is given
 * explicitly where it departs from 0.1x.
 */
function tier(input: number, output: number, cacheRead = input * 0.1): Omit<ModelPrice, 'model'> {
  const r = (n: number) => Number(n.toFixed(4))
  return {
    inputPerMTok: input,
    outputPerMTok: output,
    cacheReadPerMTok: r(cacheRead),
    cacheWritePerMTok: r(input * 1.25),
    cacheWrite1hPerMTok: r(input * 2),
  }
}

/**
 * OpenAI rates for Codex CLI sessions: standard tier, prompts up to 272K tokens. Cached
 * input has its own published rate. Cache writes use the 30-minute rate where one is
 * published (Codex logs do not record the TTL); models without one bill writes as plain
 * input. The 12-hour rate fills the second write column, which Codex usage never uses.
 */
function openai(input: number, cachedInput: number, output: number, write30m = input, write12h = write30m): Omit<ModelPrice, 'model'> {
  return {
    inputPerMTok: input,
    outputPerMTok: output,
    cacheReadPerMTok: cachedInput,
    cacheWritePerMTok: write30m,
    cacheWrite1hPerMTok: write12h,
  }
}

export const DEFAULT_PRICES: ModelPrice[] = [
  { model: 'claude-fable-5-1', ...tier(10, 50, 0.25) },
  { model: 'claude-mythos-5-1', ...tier(10, 50, 0.25) },
  { model: 'claude-fable-5', ...tier(10, 50) },
  { model: 'claude-mythos-5', ...tier(10, 50) },
  { model: 'claude-opus-5-5', ...tier(4, 20, 0.2) },
  { model: 'claude-opus-5', ...tier(5, 25) },
  { model: 'claude-opus-4-8', ...tier(5, 25) },
  { model: 'claude-opus-4-7', ...tier(5, 25) },
  { model: 'claude-opus-4-6', ...tier(5, 25) },
  { model: 'claude-opus-4-5', ...tier(5, 25) },
  { model: 'claude-opus-4-1', ...tier(15, 75) },
  { model: 'claude-opus-4', ...tier(15, 75) },
  { model: 'claude-sonnet-5-5', ...tier(2, 10) },
  { model: 'claude-sonnet-5', ...tier(2, 10) },
  { model: 'claude-sonnet-4-6', ...tier(3, 15) },
  { model: 'claude-sonnet-4-5', ...tier(3, 15) },
  { model: 'claude-sonnet-4', ...tier(3, 15) },
  { model: 'claude-3-7-sonnet', ...tier(3, 15) },
  // Prompts over 100K tokens are billed at $0.50 / $2.50; this per-model estimate
  // cannot see prompt size, so it uses the base tier.
  { model: 'claude-haiku-5-5', ...tier(0.1, 0.5) },
  { model: 'claude-haiku-4-5', ...tier(1, 5) },
  { model: 'claude-3-5-haiku', ...tier(0.8, 4) },
  // OpenAI (Codex CLI). Matching is by prefix, so every model that extends a listed name
  // is listed too: without `gpt-5.5-pro` it would be priced as `gpt-5.5` ($5, not $30).
  { model: 'gpt-6-astra', ...openai(10, 1, 50, 12.5, 25) },
  { model: 'gpt-6.1-sol', ...openai(2, 0.1, 10, 2.5, 5) },
  { model: 'gpt-6.1-terra', ...openai(1, 0.05, 5, 1.25, 2.5) },
  { model: 'gpt-6-sol', ...openai(2, 0.2, 10, 2.5, 5) },
  { model: 'gpt-6-luna', ...openai(0.1, 0.01, 0.5, 0.125, 0.25) },
  // Promotional rate, published as valid at least through 2026-11-21.
  { model: 'gpt-5.6-sol', ...openai(4, 0.4, 20, 5, 10) },
  { model: 'gpt-5.6-terra', ...openai(2, 0.2, 12, 2.5, 5) },
  { model: 'gpt-5.6-luna', ...openai(0.2, 0.02, 1.2, 0.25, 0.5) },
  { model: 'gpt-5.6-cyber', ...openai(12.5, 1.25, 75) },
  { model: 'gpt-5.5-cyber', ...openai(12.5, 1.25, 75) },
  { model: 'gpt-5.5-pro', ...openai(30, 30, 180) },
  { model: 'gpt-5.5', ...openai(5, 0.5, 30) },
  { model: 'gpt-5.4-pro', ...openai(30, 30, 180) },
  { model: 'gpt-5.4-mini', ...openai(0.75, 0.075, 4.5) },
  { model: 'gpt-5.4-nano', ...openai(0.2, 0.02, 1.25) },
  { model: 'gpt-5.4', ...openai(2.5, 0.25, 15) },
  { model: 'gpt-5.3-codex', ...openai(1.75, 0.175, 14) },
]

export type TokenCounts = {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  /** Subset of `cacheCreation` written with the 1-hour TTL. */
  cacheCreation1h?: number
}

/**
 * Longest matching prefix wins, so a specific `claude-opus-4-8` override beats a
 * broader `claude-opus` entry regardless of row order. Exact matches win outright.
 */
export function findPrice(model: string, prices: ModelPrice[]): ModelPrice | null {
  const id = model.trim().toLowerCase()
  if (!id) return null
  let best: ModelPrice | null = null
  for (const p of prices) {
    const key = p.model.trim().toLowerCase()
    if (!key) continue
    if (id === key) return p
    if (id.startsWith(key) && (!best || key.length > best.model.length)) best = p
  }
  return best
}

/** USD for one model's token totals. Returns null when no price row matches. */
export function costOf(
  model: string,
  tokens: TokenCounts,
  prices: ModelPrice[],
): number | null {
  const p = findPrice(model, prices)
  if (!p) return null
  const m = 1_000_000
  const write1h = Math.min(tokens.cacheCreation1h ?? 0, tokens.cacheCreation)
  const write5m = tokens.cacheCreation - write1h
  // A row saved before the 1-hour column existed must not turn the total into NaN.
  const rate1h = Number.isFinite(p.cacheWrite1hPerMTok) ? p.cacheWrite1hPerMTok : p.inputPerMTok * 2
  return (
    (tokens.input * p.inputPerMTok) / m +
    (tokens.output * p.outputPerMTok) / m +
    (tokens.cacheRead * p.cacheReadPerMTok) / m +
    (write5m * p.cacheWritePerMTok) / m +
    (write1h * rate1h) / m
  )
}

export function formatUsd(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.01) return '<$0.01'
  if (n < 1000) return `$${n.toFixed(2)}`
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
