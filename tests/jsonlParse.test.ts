import { describe, expect, it } from 'vitest'
import {
  effectiveRole,
  extractUsage,
  operationalLabel,
  parseJsonlLine,
  parseTimestampMs,
  stripHarnessNoise,
  summarizeToolUse,
} from '../shared/jsonlParse'

describe('parseJsonlLine', () => {
  it('parses user text message', () => {
    const line = JSON.stringify({
      role: 'user',
      message: { content: [{ type: 'text', text: 'hello world' }] },
    })
    const p = parseJsonlLine(line)
    expect(p).not.toBeNull()
    expect(p!.role).toBe('user')
    expect(p!.text).toContain('hello')
    expect(p!.messageClass).toBe('dialog')
  })

  it('returns null for empty line', () => {
    expect(parseJsonlLine('   ')).toBeNull()
  })

  it('handles invalid JSON with preview', () => {
    const p = parseJsonlLine('{not json')
    expect(p).not.toBeNull()
    expect(p!.role).toBe('unknown')
    expect(p!.contentKinds).toContain('invalid_json')
    expect(p!.tsMs).toBeNull()
    expect(p!.model).toBeNull()
    expect(p!.usage).toBeNull()
    expect(p!.isSidechain).toBe(false)
  })

  it('extracts timestamp, model, usage, and isSidechain from an assistant line', () => {
    const line = JSON.stringify({
      type: 'assistant',
      isSidechain: true,
      timestamp: '2026-07-17T18:48:35.130Z',
      message: {
        role: 'assistant',
        model: 'claude-opus-4-8',
        content: [{ type: 'text', text: 'done' }],
        usage: {
          input_tokens: 2739,
          output_tokens: 450,
          cache_read_input_tokens: 21088,
          cache_creation_input_tokens: 9534,
        },
      },
    })
    const p = parseJsonlLine(line)
    expect(p).not.toBeNull()
    expect(p!.model).toBe('claude-opus-4-8')
    expect(p!.isSidechain).toBe(true)
    expect(p!.tsMs).toBe(Date.parse('2026-07-17T18:48:35.130Z'))
    expect(p!.usage).toEqual({
      inputTokens: 2739,
      outputTokens: 450,
      cacheReadTokens: 21088,
      cacheCreationTokens: 9534,
    })
  })

  it('leaves usage null when a line carries no token counts', () => {
    const line = JSON.stringify({
      role: 'user',
      message: { content: [{ type: 'text', text: 'hi' }] },
    })
    expect(parseJsonlLine(line)!.usage).toBeNull()
  })
})

describe('bookkeeping lines (never stored as raw JSON)', () => {
  it('labels a queue-operation line and hides it as meta', () => {
    const line = JSON.stringify({
      type: 'queue-operation',
      operation: 'dequeue',
      timestamp: '2026-07-14T07:45:46.811Z',
      sessionId: '18722e4c',
    })
    const p = parseJsonlLine(line)!
    expect(p.messageClass).toBe('meta')
    expect(p.text).toBe('[대기열] dequeue')
    expect(p.text).not.toContain('{')
  })

  it('keeps the session title readable', () => {
    const line = JSON.stringify({ type: 'ai-title', aiTitle: '감염병 API 명세서 구현' })
    const p = parseJsonlLine(line)!
    expect(p.text).toBe('[제목] 감염병 API 명세서 구현')
    expect(p.messageClass).toBe('meta')
  })

  it('labels unknown content-less types instead of dumping JSON', () => {
    const p = parseJsonlLine(JSON.stringify({ type: 'brand-new-thing', foo: 1 }))!
    expect(p.text).toBe('[brand-new-thing]')
    expect(p.messageClass).toBe('meta')
  })

  it('leaves real dialog untouched', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    })
    const p = parseJsonlLine(line)!
    expect(p.messageClass).toBe('dialog')
    expect(p.text).toBe('hello')
  })
})

describe('tool results are not attributed to the human', () => {
  const toolResultLine = (text: string) =>
    JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', content: [{ type: 'text', text }] }],
      },
    })

  it('re-attributes a tool_result-only user message to the tool role', () => {
    const p = parseJsonlLine(toolResultLine('File created successfully at: /tmp/a.ts'))!
    expect(p.role).toBe('tool')
    expect(p.messageClass).toBe('dialog')
  })

  it('keeps genuine user text as the user role', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: '이거 고쳐줘' }] },
    })
    expect(parseJsonlLine(line)!.role).toBe('user')
  })

  it('keeps mixed text + tool_result as the user role', () => {
    expect(effectiveRole('user', ['text', 'tool_result'])).toBe('user')
    expect(effectiveRole('assistant', ['tool_result'])).toBe('assistant')
  })

  it('strips the harness file-state note from results', () => {
    const p = parseJsonlLine(
      toolResultLine(
        'File created successfully at: /tmp/a.ts (file state is current in your context — no need to Read it back)',
      ),
    )!
    expect(p.text).toBe('File created successfully at: /tmp/a.ts')
    expect(p.text).not.toContain('no need to Read it back')
  })
})

describe('stripHarnessNoise', () => {
  it('removes system-reminder blocks', () => {
    expect(stripHarnessNoise('keep me<system-reminder>hidden\nstuff</system-reminder>')).toBe('keep me')
  })

  it('leaves ordinary text alone', () => {
    expect(stripHarnessNoise('build ok')).toBe('build ok')
  })
})

describe('tool_result extraction', () => {
  it('labels tool_reference results instead of dumping the envelope', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_013Z',
            content: [{ type: 'tool_reference', tool_name: 'TodoWrite' }],
          },
        ],
      },
    })
    const p = parseJsonlLine(line)!
    expect(p.text).toBe('[도구 결과] TodoWrite')
    expect(p.text).not.toContain('tool_use_id')
  })

  it('still returns plain text results verbatim', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', content: [{ type: 'text', text: 'build ok' }] }],
      },
    })
    expect(parseJsonlLine(line)!.text).toBe('build ok')
  })
})

describe('summarizeToolUse', () => {
  it('renders tool calls as readable lines, not JSON', () => {
    const out = summarizeToolUse('PowerShell', {
      command: 'Get-ChildItem -Force',
      description: 'List files',
    })
    expect(out).toBe('[도구] PowerShell · List files\ncommand: Get-ChildItem -Force')
    expect(out).not.toContain('{')
  })

  it('keeps multi-line edit content searchable on its own line', () => {
    const out = summarizeToolUse('Edit', { file_path: 'src/App.tsx', new_string: 'a\nb' })
    expect(out).toContain('file_path: src/App.tsx')
    expect(out).toContain('new_string:\na\nb')
  })
})

describe('operationalLabel', () => {
  it('summarizes known bookkeeping types', () => {
    expect(operationalLabel({ mode: 'normal' }, 'mode')).toBe('[모드] normal')
    expect(operationalLabel({}, 'file-history-snapshot')).toBe('[파일 스냅샷]')
    expect(operationalLabel({ prNumber: 15, prUrl: 'http://x/1' }, 'pr-link')).toBe('[PR] #15 http://x/1')
  })
})

describe('parseTimestampMs', () => {
  it('parses ISO strings and rejects junk', () => {
    expect(parseTimestampMs('2026-07-17T18:48:35.130Z')).toBe(
      Date.parse('2026-07-17T18:48:35.130Z'),
    )
    expect(parseTimestampMs('')).toBeNull()
    expect(parseTimestampMs('not-a-date')).toBeNull()
    expect(parseTimestampMs(12345)).toBeNull()
  })
})

describe('extractUsage', () => {
  it('returns partial token maps and null on empty', () => {
    expect(extractUsage({ input_tokens: 10 })).toEqual({
      inputTokens: 10,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
    })
    expect(extractUsage({})).toBeNull()
    expect(extractUsage(null)).toBeNull()
  })
})
