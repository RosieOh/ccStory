import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRICES,
  costOf,
  findPrice,
  formatUsd,
  type ModelPrice,
} from '../shared/pricing'
import { sanitizePrices } from '../electron/ipcGuards'

const price = (model: string, i: number, o: number, cr = 0, cw = 0): ModelPrice => ({
  model,
  inputPerMTok: i,
  outputPerMTok: o,
  cacheReadPerMTok: cr,
  cacheWritePerMTok: cw,
})

describe('findPrice', () => {
  it('matches a bare model id exactly', () => {
    expect(findPrice('claude-opus-4-8', DEFAULT_PRICES)?.inputPerMTok).toBe(5)
  })

  it('matches a dated model id by prefix', () => {
    // Transcripts record ids like `claude-sonnet-4-5-20250929`.
    expect(findPrice('claude-sonnet-4-5-20250929', DEFAULT_PRICES)?.outputPerMTok).toBe(15)
  })

  it('prefers the longest matching prefix regardless of row order', () => {
    const prices = [price('claude-opus', 99, 99), price('claude-opus-4-8', 5, 25)]
    expect(findPrice('claude-opus-4-8-20260101', prices)?.inputPerMTok).toBe(5)
    // …and the same holds when the broad row comes last.
    expect(findPrice('claude-opus-4-8', prices.slice().reverse())?.inputPerMTok).toBe(5)
  })

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(findPrice('  CLAUDE-HAIKU-4-5  ', DEFAULT_PRICES)?.inputPerMTok).toBe(1)
  })

  it('returns null for an unknown model rather than guessing', () => {
    expect(findPrice('gpt-4o', DEFAULT_PRICES)).toBeNull()
    expect(findPrice('', DEFAULT_PRICES)).toBeNull()
  })

  it('does not match a shorter id against a longer key', () => {
    expect(findPrice('claude', DEFAULT_PRICES)).toBeNull()
  })
})

describe('costOf', () => {
  it('sums all four token classes at their own rates', () => {
    const prices = [price('m', 10, 20, 1, 12.5)]
    const cost = costOf('m', { input: 1e6, output: 1e6, cacheRead: 1e6, cacheCreation: 1e6 }, prices)
    expect(cost).toBeCloseTo(10 + 20 + 1 + 12.5, 9)
  })

  it('scales linearly below a million tokens', () => {
    const prices = [price('m', 3, 15)]
    expect(costOf('m', { input: 500_000, output: 0, cacheRead: 0, cacheCreation: 0 }, prices)).toBeCloseTo(1.5, 9)
  })

  it('returns null for an unpriced model so it can be excluded, not counted as free', () => {
    expect(costOf('unknown', { input: 1e9, output: 1e9, cacheRead: 0, cacheCreation: 0 }, [])).toBeNull()
  })

  it('derives cache rates from input at the published ratios', () => {
    const opus = findPrice('claude-opus-4-8', DEFAULT_PRICES)!
    expect(opus.cacheReadPerMTok).toBeCloseTo(opus.inputPerMTok * 0.1, 6)
    expect(opus.cacheWritePerMTok).toBeCloseTo(opus.inputPerMTok * 1.25, 6)
  })
})

describe('formatUsd', () => {
  it('distinguishes exactly zero from a nonzero rounding to zero', () => {
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(0.004)).toBe('<$0.01')
  })

  it('drops cents once the number is large enough not to need them', () => {
    expect(formatUsd(12.3456)).toBe('$12.35')
    expect(formatUsd(1234.56)).toBe('$1,235')
  })
})

describe('sanitizePrices', () => {
  it('coerces non-numeric and negative rates to zero', () => {
    const [row] = sanitizePrices([
      { model: 'm', inputPerMTok: 'abc', outputPerMTok: -5, cacheReadPerMTok: null, cacheWritePerMTok: 1 },
    ])
    expect(row).toEqual(price('m', 0, 0, 0, 1))
  })

  it('clamps absurd rates instead of dropping the row', () => {
    expect(sanitizePrices([{ model: 'm', inputPerMTok: 1e9 }])[0].inputPerMTok).toBe(10_000)
  })

  it('drops rows with no model id and de-duplicates by model', () => {
    const out = sanitizePrices([
      { model: '  ' },
      { model: 'm', inputPerMTok: 1 },
      { model: 'm', inputPerMTok: 2 },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].inputPerMTok).toBe(1)
  })

  it('returns an empty list for non-array input', () => {
    expect(sanitizePrices(null)).toEqual([])
    expect(sanitizePrices('nope')).toEqual([])
  })
})
