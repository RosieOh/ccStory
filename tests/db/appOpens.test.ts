import { describe, expect, it } from 'vitest'
import { localDay } from '../../shared/appOpens'
import { recordAppOpen } from '../../electron/queries'
import { computeStats } from '../../electron/stats'
import { sandbox } from './helpers'

describe('days the app was opened', () => {
  it('keeps one row per local day and reports recent days in stats', () => {
    const db = sandbox().open()
    const today = localDay(new Date())
    recordAppOpen(db, today)
    recordAppOpen(db, today)
    recordAppOpen(db, '2001-01-01')
    expect(db.prepare(`SELECT COUNT(*) AS c FROM app_opens`).get()).toEqual({ c: 2 })
    // Only the last ~two months are sent to the renderer.
    expect(computeStats(db).appOpenDays).toEqual([today])
  })
})
