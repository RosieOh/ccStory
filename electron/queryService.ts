import path from 'node:path'
import { Worker } from 'node:worker_threads'

declare const __dirname: string

type Reply = { id: number; ok: boolean; result?: unknown; error?: string }

/** Promise-based RPC to the read-only query worker; restarts it if it dies. */
export class QueryService {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private stopping = false

  constructor(private readonly dbFile: string) {}

  private ensure(): Worker {
    if (this.worker) return this.worker
    const w = new Worker(path.join(__dirname, 'queryWorker.cjs'), { workerData: { dbFile: this.dbFile } })
    w.on('message', (r: Reply) => {
      const p = this.pending.get(r.id)
      if (!p) return
      this.pending.delete(r.id)
      if (r.ok) p.resolve(r.result)
      else p.reject(new Error(r.error ?? 'query failed'))
    })
    w.on('exit', () => {
      this.worker = null
      for (const p of this.pending.values()) p.reject(new Error('query worker exited'))
      this.pending.clear()
    })
    w.on('error', (err) => console.error('[vault] query worker error', err))
    this.worker = w
    return w
  }

  private searchInFlight = false
  private pendingSearch: { args: unknown[]; resolve: (v: unknown) => void; reject: (e: Error) => void } | null = null

  /**
   * Latest-wins search. Typing fires a search per pause; a query with no token hits
   * falls back to scanning every body (hundreds of ms on a large corpus). Keep at most
   * one search running and one waiting — a newer request replaces the waiting one,
   * which resolves to `null` ("superseded") so the renderer ignores it.
   */
  search<T>(...args: unknown[]): Promise<T | null> {
    if (!this.searchInFlight) {
      this.searchInFlight = true
      return this.call<T>('search', ...args).finally(() => this.nextSearch())
    }
    this.pendingSearch?.resolve(null)
    return new Promise<T | null>((resolve, reject) => {
      this.pendingSearch = { args, resolve: resolve as (v: unknown) => void, reject }
    })
  }

  private nextSearch() {
    const next = this.pendingSearch
    this.pendingSearch = null
    if (!next) {
      this.searchInFlight = false
      return
    }
    this.call('search', ...next.args)
      .then(next.resolve, next.reject)
      .finally(() => this.nextSearch())
  }

  call<T>(method: string, ...args: unknown[]): Promise<T> {
    if (this.stopping) return Promise.reject(new Error('shutting down'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.ensure().postMessage({ id, method, args })
    })
  }

  async stop(): Promise<void> {
    this.stopping = true
    const w = this.worker
    if (!w) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => void w.terminate().finally(resolve), 2000)
      w.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      w.postMessage({ id: 0, method: '__close', args: [] })
    })
  }
}
