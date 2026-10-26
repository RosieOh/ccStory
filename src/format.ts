import type { MessageClass } from '../shared/ipc'
import { BCP47, type Locale, type MessageKey } from '../shared/i18n'

export type DateRange = 'all' | '24h' | '7d' | '30d'

/** Convert a date-range preset to an epoch-ms lower bound (null = no bound). */
export function sinceMsFor(range: DateRange): number | undefined {
  const day = 24 * 60 * 60 * 1000
  if (range === '24h') return Date.now() - day
  if (range === '7d') return Date.now() - 7 * day
  if (range === '30d') return Date.now() - 30 * day
  return undefined
}

/** Short local timestamp for hit cards; empty string when unknown. */
export function formatTs(ms: number | null | undefined, locale: Locale): string {
  if (ms == null) return ''
  return new Date(ms).toLocaleString(BCP47[locale])
}

/** 1_234_567 → "1.2M", 12_300 → "12.3K", 27_650_000_000 → "27.7B" — compact counts for tiles. */
export function formatCompact(n: number): string {
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ]
  for (const [v, u] of units) if (Math.abs(n) >= v) return `${(n / v).toFixed(1)}${u}`
  return String(n)
}

/** Returns a dictionary key, not text — the caller owns translation. */
export function messageClassKey(c: MessageClass): MessageKey | null {
  if (c === 'meta') return 'class.meta'
  if (c === 'other') return 'class.other'
  return null
}
