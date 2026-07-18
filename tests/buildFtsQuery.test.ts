import { describe, expect, it } from 'vitest'
import { buildFtsQuery } from '../electron/search'

describe('buildFtsQuery', () => {
  it('builds OR prefix tokens by default', () => {
    expect(buildFtsQuery('hello world')).toBe('"hello"* OR "world"*')
  })

  it('joins with AND in "all" mode', () => {
    expect(buildFtsQuery('hello world', 'all')).toBe('"hello"* AND "world"*')
  })

  it('treats quoted groups as exact phrases (no prefix)', () => {
    expect(buildFtsQuery('"docker compose" up')).toBe('"docker compose" OR "up"*')
  })

  it('matches the whole query as one phrase in "phrase" mode', () => {
    expect(buildFtsQuery('docker compose up', 'phrase')).toBe('"docker compose up"')
  })

  it('strips stray double quotes so the query stays well-formed', () => {
    expect(buildFtsQuery('say "hi')).toBe('"say"* OR "hi"*')
  })

  it('returns empty for blank', () => {
    expect(buildFtsQuery('  ')).toBe('')
    expect(buildFtsQuery('""', 'phrase')).toBe('')
  })
})
