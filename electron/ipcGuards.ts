import type { ModelPrice } from '../shared/pricing.js'
import type { ExportOptions, SearchFilters } from '../shared/ipc.js'

const MAX_SEARCH_LIMIT = 200
const MAX_EXPORT_MESSAGE_IDS = 5000
const DEFAULT_SEARCH_LIMIT = 80

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const x = typeof n === 'number' ? n : typeof n === 'string' ? Number(n) : NaN
  if (!Number.isFinite(x)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(x)))
}

function positiveIntOrNull(n: unknown): number | null {
  const x = typeof n === 'number' ? n : typeof n === 'string' ? Number(n) : NaN
  if (!Number.isFinite(x)) return null
  const t = Math.trunc(x)
  return t > 0 ? t : null
}

/** IPC에서 넘어온 값을 `SearchFilters`로 정규화(상한·타입). */
export function sanitizeSearchFilters(raw: unknown): SearchFilters {
  const o = isPlainObject(raw) ? raw : {}
  const query = typeof o.query === 'string' ? o.query : ''
  const projectId = positiveIntOrNull(o.projectId)
  const roleRaw = o.role
  const role =
    roleRaw === 'user' || roleRaw === 'assistant' || roleRaw === '' ? roleRaw : ''
  const limit = clampInt(o.limit, 1, MAX_SEARCH_LIMIT, DEFAULT_SEARCH_LIMIT)
  const excludeMeta = o.excludeMeta === false ? false : true
  const excludeSubagents = o.excludeSubagents === true
  const scopeRaw = o.scope
  const scope =
    scopeRaw === 'messages' || scopeRaw === 'plans' || scopeRaw === 'all' ? scopeRaw : undefined
  const matchModeRaw = o.matchMode
  const matchMode =
    matchModeRaw === 'any' || matchModeRaw === 'all' || matchModeRaw === 'phrase'
      ? matchModeRaw
      : undefined
  const sortRaw = o.sort
  const sort =
    sortRaw === 'relevance' || sortRaw === 'newest' || sortRaw === 'oldest' ? sortRaw : undefined
  const sinceMs = positiveIntOrNull(o.sinceMs)
  const untilMs = positiveIntOrNull(o.untilMs)

  const out: SearchFilters = {
    query,
    limit,
    excludeMeta,
    excludeSubagents,
  }
  if (projectId != null) out.projectId = projectId
  if (role) out.role = role as 'user' | 'assistant'
  if (scope) out.scope = scope
  if (matchMode) out.matchMode = matchMode
  if (sort) out.sort = sort
  if (sinceMs != null) out.sinceMs = sinceMs
  if (untilMs != null) out.untilMs = untilMs
  return out
}

export function sanitizeExportMessageIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const out: number[] = []
  for (const x of raw) {
    const id = positiveIntOrNull(x)
    if (id != null) out.push(id)
    if (out.length >= MAX_EXPORT_MESSAGE_IDS) break
  }
  return out
}

export function sanitizeExportOptions(raw: unknown): ExportOptions {
  if (!isPlainObject(raw)) return {}
  return {
    excludeMeta: raw.excludeMeta === false ? false : undefined,
    excludeSubagents: raw.excludeSubagents === true ? true : undefined,
  }
}

export function sanitizeSessionId(raw: unknown): number | null {
  return positiveIntOrNull(raw)
}

export function sanitizePlanId(raw: unknown): number | null {
  return positiveIntOrNull(raw)
}

export function sanitizeMessageId(raw: unknown): number | null {
  return positiveIntOrNull(raw)
}

export function sanitizeFileQuery(raw: unknown): string {
  return String(raw ?? '').trim().slice(0, 300)
}

/** A path is only ever used as an exact lookup key, so just bound its length. */
export function sanitizeFilePath(raw: unknown): string {
  return String(raw ?? '').slice(0, 1000)
}

export function sanitizeTemplateName(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .slice(0, 200)
}

export function sanitizeTemplateBody(raw: unknown): string {
  // Cap at 200k chars to keep a single template row bounded.
  return String(raw ?? '').slice(0, 200_000)
}

export function sanitizeTemplateId(raw: unknown): number | null {
  return positiveIntOrNull(raw)
}

export function sanitizeTagIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const out: number[] = []
  for (const x of raw) {
    const id = positiveIntOrNull(x)
    if (id != null) out.push(id)
    if (out.length >= 500) break
  }
  return out
}

/** Prices arrive from the renderer as free-form JSON; coerce to finite, non-negative rates. */
export function sanitizePrices(raw: unknown): ModelPrice[] {
  if (!Array.isArray(raw)) return []
  const rate = (v: unknown): number => {
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) return 0
    // Nothing plausible costs more than $10k/MTok; clamp rather than reject so a
    // fat-fingered edit degrades to a bounded number instead of dropping the row.
    return Math.min(n, 10_000)
  }
  const out: ModelPrice[] = []
  const seen = new Set<string>()
  for (const x of raw.slice(0, 200)) {
    if (!x || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    const model = String(r.model ?? '').trim().slice(0, 120)
    if (!model || seen.has(model)) continue
    seen.add(model)
    out.push({
      model,
      inputPerMTok: rate(r.inputPerMTok),
      outputPerMTok: rate(r.outputPerMTok),
      cacheReadPerMTok: rate(r.cacheReadPerMTok),
      cacheWritePerMTok: rate(r.cacheWritePerMTok),
    })
  }
  return out
}
