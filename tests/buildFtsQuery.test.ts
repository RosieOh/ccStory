import { describe, expect, it } from 'vitest'
import { buildFtsQuery } from '../electron/search'

describe('buildFtsQuery', () => {
  it('builds OR prefix tokens', () => {
    expect(buildFtsQuery('hello world')).toBe('"hello"* OR "world"*')
  })

  it('escapes double quotes in tokens', () => {
    expect(buildFtsQuery('say "hi"')).toContain('""')
  })

  it('returns empty for blank', () => {
    expect(buildFtsQuery('  ')).toBe('')
  })
})
