import {
  extractFilePaths,
  stripHarnessNoise,
  summarizeToolUse,
  type MessageClass,
  type ParsedLine,
  type UsageTokens,
} from './jsonlParse.js'

/**
 * Codex CLI rollout files (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`) wrap every
 * record as `{ timestamp, type, payload }`, so the Claude parser — which reads
 * `message` / `content` — extracts nothing from them. This parser maps the rollout
 * records onto the same `ParsedLine` shape.
 *
 * It is stateful: the model and working directory are announced once (`turn_context`,
 * `session_meta`) and apply to the lines that follow, so a file must be parsed in order
 * by one parser instance.
 */

type Rec = Record<string, unknown>

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function rec(v: unknown): Rec {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {}
}

function int(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null
}

/**
 * Codex injects its own context as user-role messages (environment, AGENTS.md, plugin
 * lists). They are not something the human typed.
 */
const INJECTED_USER_TEXT = [
  /^<environment_context>/,
  /^<user_instructions>/,
  /^<permissions instructions>/,
  /^<recommended_plugins>/,
  /^<no retained transcript/,
  /^<send_user_message_quest/,
  /^<external_codex_apps/,
  /^# AGENTS\.md instructions/,
]

/** `apply_patch` inputs name the files they touch on `*** Update File: path` lines. */
function patchFilePaths(input: string): string[] {
  const out: string[] = []
  for (const m of input.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
    const p = m[1].trim()
    if (p && !out.includes(p)) out.push(p)
  }
  return out
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const bits: string[] = []
  for (const c of content) {
    const r = rec(c)
    const t = str(r.text)
    if (t) bits.push(t)
  }
  return bits.join('\n')
}

/** Tool output is often a JSON envelope `{ output, metadata }`; show the output itself. */
function toolOutputText(output: unknown): string {
  const raw = str(output)
  if (!raw) return '[도구 결과]'
  try {
    const parsed = rec(JSON.parse(raw))
    const inner = str(parsed.output)
    if (inner) return inner
  } catch {
    /* plain text output */
  }
  return stripHarnessNoise(raw) || '[도구 결과]'
}

function usageFrom(u: Rec): UsageTokens | null {
  const input = int(u.input_tokens)
  const cached = int(u.cached_input_tokens) ?? 0
  const cacheWrite = int(u.cache_write_input_tokens) ?? 0
  const output = int(u.output_tokens)
  if (input == null && output == null) return null
  // Codex reports cached and cache-write tokens as subsets of `input_tokens`.
  return {
    inputTokens: input == null ? null : Math.max(0, input - cached - cacheWrite),
    outputTokens: output,
    cacheReadTokens: cached,
    cacheCreationTokens: cacheWrite,
    cacheCreation1hTokens: null,
  }
}

export type CodexLineParser = (line: string) => ParsedLine | null

export function createCodexLineParser(): CodexLineParser {
  let model: string | null = null
  let cwd: string | null = null

  const make = (
    obj: Rec,
    fields: Partial<ParsedLine> & { role: string; text: string; messageClass: MessageClass },
  ): ParsedLine => {
    const text = fields.text
    const ts = Date.parse(str(obj.timestamp))
    return {
      contentKinds: [],
      rawPreview: text.length > 160 ? `${text.slice(0, 160)}…` : text,
      tsMs: Number.isFinite(ts) ? ts : null,
      model,
      usage: null,
      isSidechain: false,
      filePaths: [],
      cwd,
      gitBranch: null,
      uuid: null,
      apiMessageId: null,
      requestId: null,
      isPrompt: false,
      promptText: null,
      ...fields,
    }
  }

  return (line: string): ParsedLine | null => {
    const trimmed = line.trim()
    if (!trimmed) return null
    let obj: Rec
    try {
      obj = rec(JSON.parse(trimmed))
    } catch {
      return make({}, {
        role: 'unknown',
        text: '',
        rawPreview: trimmed.slice(0, 200),
        contentKinds: ['invalid_json'],
        messageClass: 'other',
      })
    }
    const type = str(obj.type)
    const p = rec(obj.payload)
    const ptype = str(p.type)
    const meta = (text: string, extra?: Partial<ParsedLine>) =>
      make(obj, { role: 'unknown', text, messageClass: 'meta', contentKinds: [ptype || type], ...extra })

    if (type === 'session_meta') {
      cwd = str(p.cwd) || cwd
      return meta(`[세션] ${cwd ?? ''}`.trim())
    }
    if (type === 'turn_context') {
      model = str(p.model) || model
      cwd = str(p.cwd) || cwd
      return meta(`[턴 설정] ${model ?? ''}`.trim())
    }
    if (type === 'token_usage_record') {
      const usage = usageFrom(rec(p.usage))
      const responseId = str(p.response_id) || null
      return meta('[토큰 사용]', {
        role: 'assistant',
        usage,
        apiMessageId: usage ? responseId : null,
      })
    }
    if (type !== 'response_item') {
      // event_msg mirrors response_item content (user_message, agent_message) and
      // token_count repeats token_usage_record; keep them as labels only.
      return meta(`[${type}${ptype ? `:${ptype}` : ''}]`)
    }

    const uuid = str(p.id) || null
    switch (ptype) {
      case 'message': {
        const role = str(p.role)
        const text = contentText(p.content)
        if (role === 'developer' || role === 'system') {
          return meta(`[지침]\n${text.slice(0, 4000)}`, { uuid })
        }
        if (role === 'user') {
          const injected = INJECTED_USER_TEXT.some((re) => re.test(text.trimStart()))
          if (injected) return meta(text.slice(0, 4000), { role: 'user', uuid })
          const prompt = text.trim()
          return make(obj, {
            role: 'user',
            text,
            contentKinds: ['text'],
            messageClass: 'dialog',
            uuid,
            isPrompt: prompt.length > 0,
            promptText: prompt || null,
          })
        }
        return make(obj, { role: 'assistant', text, contentKinds: ['text'], messageClass: 'dialog', uuid })
      }
      case 'reasoning': {
        const summary = Array.isArray(p.summary)
          ? p.summary.map((s) => str(rec(s).text)).filter(Boolean).join('\n')
          : ''
        return make(obj, {
          role: 'assistant',
          text: summary ? `[thinking] ${summary}` : '[thinking]',
          contentKinds: ['thinking'],
          messageClass: 'meta',
          uuid,
        })
      }
      case 'function_call':
      case 'custom_tool_call': {
        const name = str(p.name) || 'tool'
        const rawInput = ptype === 'function_call' ? str(p.arguments) : str(p.input)
        let input: unknown = rawInput
        try {
          input = JSON.parse(rawInput)
        } catch {
          /* custom tools (apply_patch) take free-form text */
        }
        const filePaths = [
          ...extractFilePaths(input),
          ...(typeof input === 'string' ? patchFilePaths(input) : []),
        ]
        return make(obj, {
          role: 'assistant',
          text: summarizeToolUse(name, input),
          contentKinds: ['tool_use'],
          messageClass: 'dialog',
          filePaths: [...new Set(filePaths)],
          uuid,
        })
      }
      case 'function_call_output':
      case 'custom_tool_call_output':
        return make(obj, {
          role: 'tool',
          text: toolOutputText(p.output),
          contentKinds: ['tool_result'],
          messageClass: 'dialog',
          uuid,
        })
      default:
        return meta(`[${ptype || type}]`, { uuid })
    }
  }
}

/** First-line `session_meta.cwd` of a rollout file — how Codex sessions are grouped into projects. */
export function codexSessionCwd(firstLine: string): string | null {
  try {
    const obj = rec(JSON.parse(firstLine))
    if (str(obj.type) !== 'session_meta') return null
    return str(rec(obj.payload).cwd) || null
  } catch {
    return null
  }
}
