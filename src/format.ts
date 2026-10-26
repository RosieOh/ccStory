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

/** 1_234_567 → "1.2M", 12_300 → "12.3K" — compact token counts for stat tiles. */
export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/** Returns a dictionary key, not text — the caller owns translation. */
export function messageClassKey(c: MessageClass): MessageKey | null {
  if (c === 'meta') return 'class.meta'
  if (c === 'other') return 'class.other'
  return null
}
