import { describe, expect, it } from 'vitest'
import type { MessageHit, PlanHit } from '../shared/ipc'
import { orderedAllScopeHits } from '../electron/search'

function msg(partial: Partial<MessageHit> & Pick<MessageHit, 'messageId' | 'rank'>): MessageHit {
  return {
    hitType: 'message',
    messageId: partial.messageId,
    sessionId: partial.sessionId ?? 1,
    projectId: partial.projectId ?? 1,
    projectSlug: partial.projectSlug ?? 's',
    projectName: partial.projectName ?? 'P',
    sessionFile: partial.sessionFile ?? 'f.jsonl',
    lineIndex: partial.lineIndex ?? 0,
    role: partial.role ?? 'user',
    body: partial.body ?? '',
    snippet: partial.snippet ?? '',
    rank: partial.rank,
    messageClass: partial.messageClass ?? 'dialog',
    tsMs: partial.tsMs ?? null,
  }
}

function plan(partial: Partial<PlanHit> & Pick<PlanHit, 'planId' | 'rank' | 'mtime'>): PlanHit {
  return {
    hitType: 'plan',
    planId: partial.planId,
    filePath: partial.filePath ?? '/p.md',
    title: partial.title ?? 't',
    snippet: partial.snippet ?? '',
    rank: partial.rank,
    mtime: partial.mtime,
  }
}

describe('orderedAllScopeHits', () => {
  it('places all messages before all plans', () => {
    const messages = [msg({ messageId: 2, rank: 1 }), msg({ messageId: 1, rank: 2 })]
    const plans = [plan({ planId: 10, rank: -1, mtime: 100 }), plan({ planId: 11, rank: -2, mtime: 200 })]
    const out = orderedAllScopeHits(messages, plans)
    expect(out.map((h) => h.hitType)).toEqual(['message', 'message', 'plan', 'plan'])
  })

  it('sorts messages by rank then messageId desc tie-break', () => {
    const out = orderedAllScopeHits(
      [msg({ messageId: 1, rank: 0 }), msg({ messageId: 2, rank: 0 })],
      [],
    )
    expect((out[0] as MessageHit).messageId).toBe(2)
    expect((out[1] as MessageHit).messageId).toBe(1)
  })

  it('interleaves messages and plans by time for newest sort (missing times last)', () => {
    const messages = [
      msg({ messageId: 1, rank: 0, tsMs: 300 }),
      msg({ messageId: 2, rank: 0, tsMs: null }),
    ]
    const plans = [plan({ planId: 10, rank: 0, mtime: 500 }), plan({ planId: 11, rank: 0, mtime: 100 })]
    const out = orderedAllScopeHits(messages, plans, 'newest')
    // 500(plan10) > 300(msg1) > 100(plan11) > null(msg2)
    expect(out.map((h) => (h.hitType === 'plan' ? `p${h.planId}` : `m${h.messageId}`))).toEqual([
      'p10',
      'm1',
      'p11',
      'm2',
    ])
  })

  it('orders oldest first for oldest sort', () => {
    const out = orderedAllScopeHits(
      [msg({ messageId: 1, rank: 0, tsMs: 300 })],
      [plan({ planId: 10, rank: 0, mtime: 100 })],
      'oldest',
    )
    expect(out[0].hitType).toBe('plan')
    expect(out[1].hitType).toBe('message')
  })
})
