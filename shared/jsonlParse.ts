export type ContentPart =
  | { type: string; text?: string }
  | { type: 'tool_use'; name?: string; input?: unknown }
  | Record<string, unknown>

/** dialog: 일반 대화 / meta: 권한·제목 등 시스템 메타 / other: 분류 어려움 */
export type MessageClass = 'dialog' | 'meta' | 'other'

export type ParsedLine = {
  role: string
  text: string
  contentKinds: string[]
  rawPreview: string
  messageClass: MessageClass
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
        const input = rec.input
        parts.push(`[tool_use:${name}] ${typeof input === 'string' ? input : JSON.stringify(input ?? {})}`)
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
    }
  }

  const role = inferRole(obj)
  const message = obj.message
  let text = ''
  let contentKinds: string[] = []

  if (message && typeof message === 'object') {
    const m = message as { content?: unknown }
    const extracted = extractTextFromContent(m.content)
    text = extracted.text
    contentKinds = extracted.kinds
  } else if (typeof obj.content !== 'undefined') {
    const extracted = extractTextFromContent(obj.content)
    text = extracted.text
    contentKinds = extracted.kinds
  }

  const rawPreview =
    text.length > 0 ? truncate(text, 160) : truncate(trimmed, 200)

  const messageClass = classifyMessage(role, contentKinds, text || rawPreview)

  return { role, text, contentKinds, rawPreview, messageClass }
}
