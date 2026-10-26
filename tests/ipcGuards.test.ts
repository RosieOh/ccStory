import { describe, expect, it } from 'vitest'
import {
  sanitizeExportMessageIds,
  sanitizeMessageId,
  sanitizeMsgKey,
  sanitizePromptQuery,
  sanitizeSearchFilters,
  sanitizeSettingsPatch,
  sanitizeTagColor,
} from '../electron/ipcGuards'

describe('sanitizeSearchFilters', () => {
  it('clamps limit and keeps query', () => {
    const f = sanitizeSearchFilters({ query: 'foo', limit: 9999 })
    expect(f.query).toBe('foo')
    expect(f.limit).toBe(200)
  })

  it('accepts valid projectId', () => {
    const f = sanitizeSearchFilters({ query: 'x', projectId: 3 })
    expect(f.projectId).toBe(3)
  })

  it('drops invalid projectId', () => {
    const f = sanitizeSearchFilters({ query: 'x', projectId: -1 })
    expect(f.projectId).toBeUndefined()
  })

  it('normalizes scope', () => {
    expect(sanitizeSearchFilters({ query: 'a', scope: 'all' }).scope).toBe('all')
    expect(sanitizeSearchFilters({ query: 'a', scope: 'bogus' }).scope).toBeUndefined()
  })
})

describe('sanitizeExportMessageIds', () => {
  it('filters non-positive and caps length', () => {
    const ids = Array.from({ length: 6000 }, (_, i) => i + 1)
    const out = sanitizeExportMessageIds(ids)
    expect(out.length).toBe(5000)
    expect(out[0]).toBe(1)
  })

  it('returns empty for non-array', () => {
    expect(sanitizeExportMessageIds(null)).toEqual([])
  })
})

describe('sanitizeMessageId', () => {
  it('returns null for invalid', () => {
    expect(sanitizeMessageId('x')).toBeNull()
    expect(sanitizeMessageId(0)).toBeNull()
  })
  it('accepts positive int', () => {
    expect(sanitizeMessageId(42)).toBe(42)
  })
})

describe('new channel guards', () => {
  it('keeps tag and tool filters only when well-formed', () => {
    const f = sanitizeSearchFilters({ query: 'x', tagId: '3', excludeTools: true })
    expect(f.tagId).toBe(3)
    expect(f.excludeTools).toBe(true)
    expect(sanitizeSearchFilters({ query: 'x', tagId: -1 }).tagId).toBeUndefined()
  })

  it('bounds message keys and tag colors', () => {
    expect(sanitizeMsgKey('  abc ')).toBe('abc')
    expect(sanitizeMsgKey(42)).toBeNull()
    expect(sanitizeMsgKey('x'.repeat(2001))).toBeNull()
    expect(sanitizeTagColor('#a1b2c3')).toBe('#a1b2c3')
    expect(sanitizeTagColor('red; background:url(x)')).toBeNull()
  })

  it('accepts only known settings values', () => {
    expect(sanitizeSettingsPatch({ archiveMode: 'mirror', autoUpdate: false })).toEqual({
      archiveMode: 'mirror',
      autoUpdate: false,
    })
    expect(sanitizeSettingsPatch({ archiveMode: 'nuke', autoUpdate: 'yes' })).toEqual({})
  })

  it('normalizes prompt queries', () => {
    expect(sanitizePromptQuery({ query: 'q', sort: 'frequent', limit: 9999, projectId: 2 })).toEqual({
      query: 'q',
      sort: 'frequent',
      limit: 500,
      projectId: 2,
    })
    expect(sanitizePromptQuery(null)).toEqual({ query: '', sort: 'recent', limit: 200 })
  })
})
