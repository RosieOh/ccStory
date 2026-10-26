import { describe, expect, it } from 'vitest'
import { QueryService } from '../electron/queryService'

/** QueryService with the worker replaced by manually resolved calls. */
class FakeQueries extends QueryService {
  started: { args: unknown[]; resolve: (v: unknown) => void }[] = []
  constructor() {
    super('unused.db')
  }
  override call<T>(_method: string, ...args: unknown[]): Promise<T> {
    return new Promise<T>((resolve) => this.started.push({ args, resolve: resolve as (v: unknown) => void }))
  }
}

describe('latest-wins search', () => {
  it('runs one search at a time and drops waiting requests a newer one replaces', async () => {
    const q = new FakeQueries()
    const a = q.search('a')
    const b = q.search('b')
    const c = q.search('c')
    expect(q.started.map((s) => s.args[0])).toEqual(['a'])
    await expect(b).resolves.toBeNull()

    q.started[0].resolve(['hit-a'])
    await expect(a).resolves.toEqual(['hit-a'])
    await new Promise((r) => setTimeout(r, 0))
    expect(q.started.map((s) => s.args[0])).toEqual(['a', 'c'])

    q.started[1].resolve(['hit-c'])
    await expect(c).resolves.toEqual(['hit-c'])
    // Idle again: the next search starts immediately.
    void q.search('d')
    expect(q.started.map((s) => s.args[0])).toEqual(['a', 'c', 'd'])
  })
})
