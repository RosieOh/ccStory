import { describe, expect, it } from 'vitest'
import {
  sanitizeExportMessageIds,
  sanitizeMessageId,
  sanitizeSearchFilters,
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
