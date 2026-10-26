import { describe, expect, it } from 'vitest'
import { formatCompact } from '../src/format'

describe('formatCompact', () => {
  it('compacts through billions', () => {
    expect(formatCompact(999)).toBe('999')
    expect(formatCompact(12_300)).toBe('12.3K')
    expect(formatCompact(1_234_567)).toBe('1.2M')
    expect(formatCompact(27_650_300_000)).toBe('27.7B')
  })
})
