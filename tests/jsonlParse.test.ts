import { describe, expect, it } from 'vitest'
import { parseJsonlLine } from '../shared/jsonlParse'

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
  })
})
