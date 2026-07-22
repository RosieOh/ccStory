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
  cacheWritePerMTok: number
}

/** The date the seeded numbers below were taken from Anthropic's published pricing. */
export const PRICES_AS_OF = '2026-07-19'

/**
 * Keys are matched as prefixes against the `model` string recorded in the
 * transcript, so `claude-sonnet-4-5-20250929` resolves via `claude-sonnet-4-5`.
 *
 * Cache multipliers follow the published ratios: reads are 0.1x input, and
 * writes are 1.25x input for the 5-minute TTL (the Claude Code default).
 */
function tier(input: number, output: number): Omit<ModelPrice, 'model'> {
  return {
    inputPerMTok: input,
    outputPerMTok: output,
    cacheReadPerMTok: Number((input * 0.1).toFixed(4)),
    cacheWritePerMTok: Number((input * 1.25).toFixed(4)),
  }
}

export const DEFAULT_PRICES: ModelPrice[] = [
  { model: 'claude-fable-5', ...tier(10, 50) },
  { model: 'claude-mythos-5', ...tier(10, 50) },
  { model: 'claude-opus-4-8', ...tier(5, 25) },
  { model: 'claude-opus-4-7', ...tier(5, 25) },
  { model: 'claude-opus-4-6', ...tier(5, 25) },
  { model: 'claude-opus-4-5', ...tier(5, 25) },
  { model: 'claude-opus-4-1', ...tier(15, 75) },
  { model: 'claude-opus-4', ...tier(15, 75) },
  { model: 'claude-sonnet-5', ...tier(3, 15) },
  { model: 'claude-sonnet-4-6', ...tier(3, 15) },
  { model: 'claude-sonnet-4-5', ...tier(3, 15) },
  { model: 'claude-sonnet-4', ...tier(3, 15) },
  { model: 'claude-3-7-sonnet', ...tier(3, 15) },
  { model: 'claude-haiku-4-5', ...tier(1, 5) },
  { model: 'claude-3-5-haiku', ...tier(0.8, 4) },
]

export type TokenCounts = {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
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
  return (
    (tokens.input * p.inputPerMTok) / m +
    (tokens.output * p.outputPerMTok) / m +
    (tokens.cacheRead * p.cacheReadPerMTok) / m +
    (tokens.cacheCreation * p.cacheWritePerMTok) / m
  )
}

export function formatUsd(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.01) return '<$0.01'
  if (n < 1000) return `$${n.toFixed(2)}`
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
