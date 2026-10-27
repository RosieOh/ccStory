/**
 * Search latency benchmark (PRD success metric: p95 < 200 ms on a large corpus).
 * Opens an existing vault DB read-only and runs representative queries through the
 * same `unifiedSearch` the app uses, with the UI's default filters.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { unifiedSearch } from '../electron/search.js'
import type { SearchFilters } from '../shared/ipc.js'

const candidates = [
  process.argv[2],
  path.join(os.homedir(), 'Library', 'Application Support', 'ccStory', 'vault.db'),
  path.join(os.homedir(), 'Library', 'Application Support', 'claude-vault', 'vault.db'),
].filter((p): p is string => Boolean(p))
const dbFile = candidates.find((p) => fs.existsSync(p))
if (!dbFile) {
  console.error('No vault DB found. Pass a path: npm run bench -- /path/to/vault.db')
  process.exit(1)
}
const db = new Database(dbFile, { readonly: true, fileMustExist: true })

const QUERIES: [string, Partial<SearchFilters>][] = [
  ['error', {}],
  ['worker thread', {}],
  ['"type error"', {}],
  ['build failed', { matchMode: 'all' }],
  ['검색', {}],
  ['즐겨찾기 태그', {}],
  ['색인', {}], // infix in Korean words → substring fallback
  ['App.tsx', { sort: 'newest' }],
  ['migration', { excludeTools: true }],
  // Generated per run so it can never appear in a transcript: no FTS hit, so the
  // substring fallback scans every message body — the worst case.
  [`zz${Math.random().toString(36).slice(2, 10)}`, {}],
]
const RUNS = 15

const rows = (db.prepare(`SELECT COUNT(*) AS c FROM messages`).get() as { c: number }).c
console.log(`DB: ${dbFile} (${rows.toLocaleString()} messages)\n`)
const typical: number[] = []
let worst: number[] = []
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]
for (const [query, extra] of QUERIES) {
  const filters: SearchFilters = { query, limit: 120, excludeMeta: true, scope: 'messages', ...extra }
  unifiedSearch(db, filters) // warm-up
  const times: number[] = []
  let hits = 0
  for (let i = 0; i < RUNS; i += 1) {
    const t = performance.now()
    hits = unifiedSearch(db, filters).length
    times.push(performance.now() - t)
  }
  if (query.startsWith('zz')) worst = times
  else typical.push(...times)
  console.log(`${query.padEnd(18)} hits ${String(hits).padStart(4)}   p50 ${pct(times, 50).toFixed(1).padStart(7)} ms   p95 ${pct(times, 95).toFixed(1).padStart(7)} ms`)
}
console.log(`\ntypical queries    p50 ${pct(typical, 50).toFixed(1)} ms   p95 ${pct(typical, 95).toFixed(1)} ms   (target p95 < 200 ms)`)
console.log(`no-hit worst case  p50 ${pct(worst, 50).toFixed(1)} ms   p95 ${pct(worst, 95).toFixed(1)} ms   (runs on the query worker; at most one waits)`)
