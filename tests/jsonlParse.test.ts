import { describe, expect, it } from 'vitest'
import { extractUsage, parseJsonlLine, parseTimestampMs } from '../shared/jsonlParse'

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
