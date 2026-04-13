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
})
