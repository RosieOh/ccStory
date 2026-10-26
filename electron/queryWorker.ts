import { parentPort, workerData } from 'node:worker_threads'
import { openVaultDb } from './db.js'
import { unifiedSearch } from './search.js'
import { computeStats } from './stats.js'
import { fileTimeline, listFiles } from './files.js'
import { listPrompts, sessionTranscript } from './queries.js'
import type { PromptQuery, SearchFilters } from '../shared/ipc.js'

/**
 * Read-only query worker. Searches (including the substring fallback, which scans
 * every message body), stats and full transcripts can each take hundreds of
 * milliseconds on a real corpus; running them here keeps the main thread — and so
 * every other IPC call — responsive.
 */

const { dbFile } = workerData as { dbFile: string }
const db = openVaultDb(dbFile, { migrate: false })
db.pragma('query_only = ON')

const handlers: Record<string, (...args: never[]) => unknown> = {
  search: (f: SearchFilters) => unifiedSearch(db, f),
  stats: () => computeStats(db),
  transcript: (sessionId: number) => sessionTranscript(db, sessionId),
  prompts: (q: PromptQuery) => listPrompts(db, q),
  filesList: (query: string) => listFiles(db, query),
  fileTimeline: (p: string) => fileTimeline(db, p),
}

parentPort!.on('message', (m: { id: number; method: string; args: unknown[] }) => {
  if (m.method === '__close') {
    db.close()
    process.exit(0)
  }
  const fn = handlers[m.method]
  try {
    if (!fn) throw new Error(`unknown query ${m.method}`)
    parentPort!.postMessage({ id: m.id, ok: true, result: fn(...(m.args as never[])) })
  } catch (err) {
    parentPort!.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})
