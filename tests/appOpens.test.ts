import { describe, expect, it } from 'vitest'
import { localDay, openWeeks } from '../shared/appOpens'

describe('localDay', () => {
  it('uses the local calendar day, not UTC', () => {
    // 23:30 local on Oct 26 is still Oct 26 whatever the UTC date is.
    expect(localDay(new Date(2026, 9, 26, 23, 30))).toBe('2026-10-26')
    expect(localDay(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05')
  })
})

describe('openWeeks', () => {
  // Tuesday, 2026-10-27.
  const today = new Date(2026, 9, 27, 15, 0)

  it('returns Monday-started weeks ending with the current one, oldest first', () => {
    const weeks = openWeeks([], today)
    expect(weeks.map((w) => w.start)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
    expect(weeks.every((w) => w.days.length === 7)).toBe(true)
    expect(weeks[3].days.map((d) => d.future)).toEqual([false, false, true, true, true, true, true])
  })

  it('counts opened days per week and ignores days outside the window', () => {
    const weeks = openWeeks(['2026-09-30', '2026-10-13', '2026-10-14', '2026-10-18', '2026-10-27'], today)
    expect(weeks.map((w) => w.count)).toEqual([0, 3, 0, 1])
    expect(weeks[1].days.filter((d) => d.opened).map((d) => d.day)).toEqual(['2026-10-13', '2026-10-14', '2026-10-18'])
  })

  it('treats Sunday as the last day of its week', () => {
    const sunday = new Date(2026, 10, 1, 9, 0)
    const [current] = openWeeks(['2026-11-01'], sunday, 1)
    expect(current.start).toBe('2026-10-26')
    expect(current.count).toBe(1)
    expect(current.days.some((d) => d.future)).toBe(false)
  })
})
