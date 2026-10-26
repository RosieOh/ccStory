import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { IndexProgress, ReindexResult } from '../shared/ipc.js'
import type { WatchEventKind, WorkerInbound, WorkerOutbound } from './workerProtocol.js'

declare const __dirname: string

type Pending<T> = { resolve: (v: T) => void; reject: (e: Error) => void }

/**
 * Main-process handle on the index worker: request/response for scans,
 * fire-and-forget for file events, and callbacks for progress and "index changed".
 * If the worker dies, pending requests fail and it is restarted (up to three times).
 */
export class IndexService {
  private worker: Worker | null = null
  private nextId = 1
  private scans = new Map<number, Pending<ReindexResult>>()
  private stopping = false
  /** Crash-restart budget, so a worker that cannot open the DB does not spin forever. */
  private restarts = 0

  constructor(
    private readonly opts: {
      dbFile: string
      plansRoot: string
      onProgress: (p: IndexProgress) => void
      onUpdated: () => void
      onError: (message: string) => void
    },
  ) {}

  start(): void {
    const worker = new Worker(path.join(__dirname, 'indexWorker.cjs'), {
      workerData: { dbFile: this.opts.dbFile, plansRoot: this.opts.plansRoot },
    })
    worker.on('message', (m: WorkerOutbound) => this.onMessage(m))
    worker.on('error', (err) => this.opts.onError(`index worker crashed: ${err.stack ?? err.message}`))
    worker.on('exit', (code) => {
      this.worker = null
      const err = new Error(`index worker exited (${code})`)
      for (const p of this.scans.values()) p.reject(err)
      this.scans.clear()
      if (!this.stopping && code !== 0 && this.restarts++ < 3) this.start()
    })
    this.worker = worker
  }

  private send(m: WorkerInbound) {
    if (!this.worker) this.start()
    this.worker!.postMessage(m)
  }

  private onMessage(m: WorkerOutbound) {
    switch (m.type) {
      case 'progress':
        this.opts.onProgress(m.progress)
        break
      case 'updated':
        this.opts.onUpdated()
        break
      case 'done':
        this.scans.get(m.id)?.resolve(m.result)
        this.scans.delete(m.id)
        break
      case 'error': {
        const err = new Error(m.message)
        if (m.id != null) {
          this.scans.get(m.id)?.reject(err)
          this.scans.delete(m.id)
        } else {
          this.opts.onError(m.message)
        }
        break
      }
      case 'log':
        console.error('[vault:index]', m.message)
        break
    }
  }

  /** Full scan of every source; `reparse` re-reads every live file from byte 0. */
  scan(reparse = false): Promise<ReindexResult> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.scans.set(id, { resolve, reject })
      this.send({ type: 'scan', id, reparse })
    })
  }

  notify(events: { path: string; kind: WatchEventKind }[]): void {
    if (events.length) this.send({ type: 'paths', events })
  }

  async stop(): Promise<void> {
    this.stopping = true
    const w = this.worker
    if (!w) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        void w.terminate().finally(resolve)
      }, 2000)
      w.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      w.postMessage({ type: 'close' } satisfies WorkerInbound)
    })
  }
}
