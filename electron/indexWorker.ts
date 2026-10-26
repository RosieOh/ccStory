import { parentPort, workerData } from 'node:worker_threads'
import { openVaultDb, requestFullReparse } from './db.js'
import { BackupError, snapshot } from './backup.js'
import { getAvailableAdapters } from './adapters.js'
import { archiveModeOf, handleSessionUnlink, indexAdapterProject, indexSinglePath, reconcileMissing } from './indexer.js'
import { fullReindexPlans, indexPlanSinglePath, isPathUnderPlansRoot } from './plansIndexer.js'
import type { BackupReason } from '../shared/ipc.js'
import type { WorkerInbound, WorkerOutbound } from './workerProtocol.js'

/**
 * Index worker. Everything that reads transcript files or writes the index runs here,
 * off the Electron main thread: a stalled main thread freezes every IPC call and so
 * the whole window. It owns its own SQLite connection (WAL lets readers proceed
 * concurrently) and processes one job at a time, yielding between batches so new file
 * events queue up during a long scan instead of blocking it.
 */

const { dbFile, plansRoot } = workerData as { dbFile: string; plansRoot: string }
const db = openVaultDb(dbFile, { migrate: false })

const post = (m: WorkerOutbound) => parentPort!.postMessage(m)
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

let lastUpdated = 0
/** Coalesce "index changed" pings so a big scan doesn't flood the renderer. */
function notifyUpdated(force = false) {
  const now = Date.now()
  if (force || now - lastUpdated > 750) {
    lastUpdated = now
    post({ type: 'updated' })
  }
}

// Backups share the queue with scans: one job at a time on this connection, so a
// snapshot never races a scan's write batches.
type Job = { kind: 'scan'; id: number; reparse: boolean } | { kind: 'backup'; id: number; dir: string; reason: BackupReason }
const scanQueue: Job[] = []
const pendingPaths = new Map<string, 'add' | 'change' | 'unlink'>()
let running = false

function runBackup(job: Extract<Job, { kind: 'backup' }>) {
  try {
    post({ type: 'backupDone', id: job.id, file: snapshot(db, job.dir, job.reason) })
  } catch (err) {
    const code = err instanceof BackupError && err.code === 'disk' ? 'disk' : 'failed'
    post({ type: 'backupFailed', id: job.id, code, message: err instanceof Error ? err.message : String(err) })
  }
}

async function runScan(job: Extract<Job, { kind: 'scan' }>) {
  if (job.reparse) requestFullReparse(db)
  const mode = archiveModeOf(db)
  const live = getAvailableAdapters()
  const jobs = live.flatMap((adapter) => adapter.listProjects().map((project) => ({ adapter, project })))
  let sessions = 0
  for (let i = 0; i < jobs.length; i += 1) {
    const { adapter, project } = jobs[i]
    sessions += await indexAdapterProject(db, adapter, project, tick)
    post({ type: 'progress', progress: { phase: 'projects', current: i + 1, total: jobs.length, label: project.displayName } })
    notifyUpdated()
  }
  for (const adapter of live) reconcileMissing(db, adapter, mode)
  post({ type: 'progress', progress: { phase: 'plans', current: 0, total: 1 } })
  await tick()
  const plans = fullReindexPlans(db, plansRoot)
  // A full scan can leave hundreds of MB in the WAL; fold it back into the main file.
  // Best effort: an open reader on the query worker just makes this a partial checkpoint.
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    /* checkpoint is an optimization */
  }
  post({ type: 'progress', progress: { phase: 'done', current: jobs.length, total: jobs.length } })
  notifyUpdated(true)
  post({ type: 'done', id: job.id, result: { projects: jobs.length, sessions, planFiles: plans.planFiles } })
}

async function runPaths() {
  const mode = archiveModeOf(db)
  const adapters = getAvailableAdapters()
  let changed = false
  while (pendingPaths.size) {
    const [p, kind] = pendingPaths.entries().next().value as [string, 'add' | 'change' | 'unlink']
    pendingPaths.delete(p)
    try {
      if (isPathUnderPlansRoot(plansRoot, p)) {
        if (p.toLowerCase().endsWith('.md')) {
          indexPlanSinglePath(db, plansRoot, p)
          changed = true
        }
      } else if (p.toLowerCase().endsWith('.jsonl')) {
        if (kind === 'unlink') changed = handleSessionUnlink(db, p, mode) || changed
        else changed = (await indexSinglePath(db, adapters, p, tick)) || changed
      }
    } catch (err) {
      post({ type: 'log', message: `failed to index ${p}: ${String(err)}` })
    }
    await tick()
  }
  if (changed) notifyUpdated(true)
}

async function pump() {
  if (running) return
  running = true
  try {
    while (scanQueue.length || pendingPaths.size) {
      const job = scanQueue.shift()
      if (job?.kind === 'backup') {
        runBackup(job)
        continue
      }
      if (job) {
        try {
          await runScan(job)
        } catch (err) {
          post({ type: 'error', id: job.id, message: err instanceof Error ? (err.stack ?? err.message) : String(err) })
        }
        continue
      }
      await runPaths()
    }
  } finally {
    running = false
  }
}

parentPort!.on('message', (m: WorkerInbound) => {
  switch (m.type) {
    case 'scan':
      scanQueue.push({ kind: 'scan', id: m.id, reparse: m.reparse === true })
      void pump()
      break
    case 'paths':
      for (const e of m.events) pendingPaths.set(e.path, e.kind)
      void pump()
      break
    case 'backup':
      scanQueue.push({ kind: 'backup', id: m.id, dir: m.dir, reason: m.reason })
      void pump()
      break
    case 'close':
      try {
        db.close()
      } finally {
        process.exit(0)
      }
  }
})

post({ type: 'ready' })
