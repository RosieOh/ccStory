export type ContentPart =
  | { type: string; text?: string }
  | { type: 'tool_use'; name?: string; input?: unknown }
  | Record<string, unknown>

/** dialog: 일반 대화 / meta: 권한·제목 등 시스템 메타 / other: 분류 어려움 */
export type MessageClass = 'dialog' | 'meta' | 'other'

/** Token usage extracted from an assistant line's `message.usage`. */
export type UsageTokens = {
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
}

export type ParsedLine = {
  role: string
  text: string
  contentKinds: string[]
  rawPreview: string
  messageClass: MessageClass
  /** Epoch ms parsed from the line's ISO `timestamp`, or null when absent/unparsable. */
  tsMs: number | null
  /** Model id from `message.model` (assistant lines), or null. */
  model: string | null
  /** Token usage from `message.usage`, or null when the line carries none. */
  usage: UsageTokens | null
  /** `isSidechain` flag — Claude Code marks subagent/side-thread lines true. */
  isSidechain: boolean
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}…`
}

const AUX_META_KINDS = new Set([
  'thinking',
])

/** Kinds that usually represent UI/system metadata rather than user chat. */
const META_KINDS = new Set([
  'permission-mode',
  'agent-name',
  'custom-title',
  'session-id',
  'model-info',
  'version-info',
  'pricing',
  'rate-limits',
  'context-compact',
  'summary',
  'stop-reason',
  'citations',
])

/**
 * Top-level `type` values that are Claude Code bookkeeping, not conversation
 * (queue bookkeeping, file snapshots, mode switches…). These lines carry no
 * `message.content`, so without special handling their raw JSON would be stored
 * as the message body and shown as if it were dialog.
 */
const OPERATIONAL_TYPES = new Set([
  'queue-operation',
  'file-history-snapshot',
  'file-history-delta',
  'attachment',
  'mode',
  'frame-link',
  'permission-mode',
  'last-prompt',
  'ai-title',
  'pr-link',
  'session-id',
  'model-info',
  'version-info',
])

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Short human-readable label for a content-less bookkeeping line. */
export function operationalLabel(obj: Record<string, unknown>, type: string): string {
  switch (type) {
    case 'queue-operation': {
      const op = str(obj.operation)
      return op ? `[대기열] ${op}` : '[대기열]'
    }
    case 'file-history-snapshot':
      return '[파일 스냅샷]'
    case 'file-history-delta':
      return '[파일 변경 기록]'
    case 'attachment': {
      const a = obj.attachment
      const kind = a && typeof a === 'object' ? str((a as Record<string, unknown>).type) : ''
      return kind ? `[첨부] ${kind}` : '[첨부]'
    }
    case 'mode': {
      const m = str(obj.mode)
      return m ? `[모드] ${m}` : '[모드]'
    }
    case 'frame-link':
      return '[프레임 링크]'
    case 'last-prompt':
      return '[최근 프롬프트 참조]'
    case 'ai-title': {
      const t = str(obj.aiTitle) || str(obj.title)
      return t ? `[제목] ${t}` : '[제목]'
    }
    case 'pr-link': {
      const n = obj.prNumber
      const url = str(obj.prUrl)
      const num = typeof n === 'number' ? `#${n}` : ''
      return `[PR] ${num} ${url}`.replace(/\s+/g, ' ').trim()
    }
    default:
      return `[${type}]`
  }
}

function textFromLastPromptPart(item: Record<string, unknown>): string | null {
  if (item.type !== 'last-prompt') return null
  const lp = item.lastPrompt
  return typeof lp === 'string' && lp.trim().length > 0 ? lp : null
}

function summarizeMetaPart(item: Record<string, unknown>, t: string): string {
  switch (t) {
    case 'permission-mode': {
      const pm = item.permissionMode
      return typeof pm === 'string' ? `[권한 모드] ${pm}` : '[권한 모드]'
    }
    case 'agent-name': {
      const n = (item.agentName ?? item.name) as unknown
      return typeof n === 'string' ? `[에이전트] ${n}` : '[에이전트]'
    }
    case 'custom-title': {
      const title = (item.title ?? item.customTitle) as unknown
      return typeof title === 'string' ? `[제목] ${title}` : '[제목]'
    }
    case 'session-id': {
      const sid = item.sessionId
      return typeof sid === 'string' ? `[세션] ${sid.slice(0, 8)}…` : '[세션]'
    }
    default:
      return `[${t}]`
  }
}

/**
 * Render a tool call as readable lines instead of a raw JSON dump, e.g.
 *   [도구] Edit · Fix null check
 *   file_path: src/App.tsx
 *   new_string:
 *   …
 * Every value is still emitted verbatim, so the tool input stays searchable.
 */
export function summarizeToolUse(name: string, input: unknown): string {
  if (typeof input === 'string') return `[도구] ${name}\n${input}`
  if (!input || typeof input !== 'object') return `[도구] ${name}`
  const rec = input as Record<string, unknown>
  const desc = str(rec.description)
  const lines: string[] = [desc ? `[도구] ${name} · ${desc}` : `[도구] ${name}`]
  for (const [k, v] of Object.entries(rec)) {
    if (k === 'description') continue
    if (typeof v === 'string') {
      lines.push(v.includes('\n') ? `${k}:\n${v}` : `${k}: ${v}`)
    } else if (v == null) {
      continue
    } else if (typeof v === 'object') {
      lines.push(`${k}: ${JSON.stringify(v)}`)
    } else {
      lines.push(`${k}: ${String(v)}`)
    }
  }
  return lines.join('\n')
}

function textFromToolResult(item: Record<string, unknown>): string {
  const c = item.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    const bits: string[] = []
    for (const x of c) {
      if (!x || typeof x !== 'object') continue
      const o = x as { type?: string; text?: string }
      if (o.type === 'text' && typeof o.text === 'string') bits.push(o.text)
    }
    if (bits.length) return bits.join('\n')
  }
  const text = item.text
  if (typeof text === 'string') return text
  return JSON.stringify(item)
}

function textFromThinking(item: Record<string, unknown>): string {
  const th = item.thinking
  if (typeof th === 'string' && th.trim()) return `[thinking] ${th}`
  const text = item.text
  if (typeof text === 'string' && text.trim()) return `[thinking] ${text}`
  return '[thinking]'
}

function toIntOrNull(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.trunc(v)
}

/** Parse an ISO-8601 timestamp field to epoch ms; null when missing/invalid. */
export function parseTimestampMs(v: unknown): number | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const ms = Date.parse(v)
  return Number.isFinite(ms) ? ms : null
}

/** Pull `{ input, output, cache_read, cache_creation }` tokens from a `usage` object. */
export function extractUsage(usage: unknown): UsageTokens | null {
  if (!usage || typeof usage !== 'object') return null
  const u = usage as Record<string, unknown>
  const out: UsageTokens = {
    inputTokens: toIntOrNull(u.input_tokens),
    outputTokens: toIntOrNull(u.output_tokens),
    cacheReadTokens: toIntOrNull(u.cache_read_input_tokens),
    cacheCreationTokens: toIntOrNull(u.cache_creation_input_tokens),
  }
  if (
    out.inputTokens == null &&
    out.outputTokens == null &&
    out.cacheReadTokens == null &&
    out.cacheCreationTokens == null
  ) {
    return null
  }
  return out
}

function inferRole(obj: Record<string, unknown>): string {
  const r = obj.role
  if (typeof r === 'string' && r.length > 0) return r
  const msg = obj.message
  if (msg && typeof msg === 'object') {
    const mr = (msg as { role?: string }).role
    if (typeof mr === 'string' && mr.length > 0) return mr
  }
  return 'unknown'
}

export function classifyMessage(
  role: string,
  contentKinds: string[],
  body: string,
): MessageClass {
  const dialogRoles = new Set(['user', 'assistant'])
  if (dialogRoles.has(role) && (contentKinds.includes('text') || contentKinds.includes('string'))) {
    return 'dialog'
  }
  if (dialogRoles.has(role) && contentKinds.some((k) => k === 'tool_use' || k === 'tool_result')) {
    return 'dialog'
  }
  const onlyMeta =
    contentKinds.length > 0 &&
    contentKinds.every((k) => META_KINDS.has(k) || AUX_META_KINDS.has(k)) &&
    !contentKinds.includes('text') &&
    !contentKinds.includes('string') &&
    !contentKinds.includes('last-prompt') &&
    !contentKinds.includes('tool_use') &&
    !contentKinds.includes('tool_result')
  if (onlyMeta) return 'meta'
  if (
    role === 'unknown' &&
    contentKinds.length > 0 &&
    contentKinds.every((k) => META_KINDS.has(k) || k.startsWith('object'))
  ) {
    return 'meta'
  }
  if (role === 'unknown' && /^\[(권한|에이전트|제목|세션|tool_use)/.test(body.trim())) {
    return 'meta'
  }
  if (dialogRoles.has(role)) return 'dialog'
  if (role === 'system') return 'meta'
  return 'other'
}

export function extractTextFromContent(content: unknown): {
  text: string
  kinds: string[]
} {
  const kinds: string[] = []
  if (content == null) return { text: '', kinds }

  if (typeof content === 'string') {
    kinds.push('string')
    return { text: content, kinds }
  }

  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const item of content) {
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      const t = rec.type
      const ts = typeof t === 'string' ? t : ''
      if (ts) kinds.push(ts)
      if (ts === 'text' && typeof rec.text === 'string') {
        parts.push(rec.text)
      } else if (ts === 'last-prompt') {
        const lp = textFromLastPromptPart(rec)
        parts.push(lp ?? '[last-prompt]')
      } else if (META_KINDS.has(ts)) {
        parts.push(summarizeMetaPart(rec, ts))
      } else if (ts === 'tool_use') {
        const name = typeof rec.name === 'string' ? rec.name : 'tool'
        parts.push(summarizeToolUse(name, rec.input))
      } else if (ts === 'tool_result') {
        parts.push(textFromToolResult(rec))
      } else if (ts === 'thinking') {
        parts.push(textFromThinking(rec))
      } else if (ts && ts !== 'text') {
        parts.push(summarizeMetaPart(rec, ts))
      }
    }
    return { text: parts.join('\n'), kinds: [...new Set(kinds)] }
  }

  if (typeof content === 'object' && content !== null && !Array.isArray(content)) {
    const c = content as Record<string, unknown>
    const lp = textFromLastPromptPart(c)
    if (lp) {
      kinds.push('last-prompt')
      return { text: lp, kinds }
    }
    const ty = typeof c.type === 'string' ? c.type : ''
    if (ty && META_KINDS.has(ty)) {
      kinds.push(ty)
      return { text: summarizeMetaPart(c, ty), kinds }
    }
    if (ty === 'tool_result') {
      kinds.push('tool_result')
      return { text: textFromToolResult(c), kinds }
    }
    if (ty === 'thinking') {
      kinds.push('thinking')
      return { text: textFromThinking(c), kinds }
    }
  }

  if (typeof content === 'object' && 'text' in (content as object)) {
    const tx = (content as { text?: unknown }).text
    if (typeof tx === 'string') {
      kinds.push('object.text')
      return { text: tx, kinds }
    }
  }

  kinds.push('unknown')
  return { text: JSON.stringify(content), kinds }
}

export function parseJsonlLine(line: string): ParsedLine | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return {
      role: 'unknown',
      text: '',
      contentKinds: ['invalid_json'],
      rawPreview: truncate(trimmed, 200),
      messageClass: 'other',
      tsMs: null,
      model: null,
      usage: null,
      isSidechain: false,
    }
  }

  const role = inferRole(obj)
  const message = obj.message
  let text = ''
  let contentKinds: string[] = []
  let model: string | null = null
  let usage: UsageTokens | null = null

  if (message && typeof message === 'object') {
    const m = message as { content?: unknown; model?: unknown; usage?: unknown }
    const extracted = extractTextFromContent(m.content)
    text = extracted.text
    contentKinds = extracted.kinds
    if (typeof m.model === 'string' && m.model.trim()) model = m.model
    usage = extractUsage(m.usage)
  } else if (typeof obj.content !== 'undefined') {
    const extracted = extractTextFromContent(obj.content)
    text = extracted.text
    contentKinds = extracted.kinds
  }

  const topType = str(obj.type)
  // A line with no extractable content is bookkeeping, not conversation. Give it
  // a short label (never the raw JSON) and file it under `meta` so the default
  // filters hide it from search results and the transcript.
  let isBookkeeping = false
  if (!text.trim() && topType && topType !== 'user' && topType !== 'assistant') {
    text = operationalLabel(obj, topType)
    if (!contentKinds.length) contentKinds = [topType]
    isBookkeeping = true
  } else if (!text.trim() && OPERATIONAL_TYPES.has(topType)) {
    text = operationalLabel(obj, topType)
    isBookkeeping = true
  }

  const rawPreview =
    text.length > 0 ? truncate(text, 160) : truncate(trimmed, 200)

  const messageClass = isBookkeeping
    ? 'meta'
    : classifyMessage(role, contentKinds, text || rawPreview)
  const tsMs = parseTimestampMs(obj.timestamp)
  const isSidechain = obj.isSidechain === true

  return { role, text, contentKinds, rawPreview, messageClass, tsMs, model, usage, isSidechain }
}
