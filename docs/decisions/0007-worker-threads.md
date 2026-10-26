# ADR-0007: Index and query work runs on worker threads

- Status: Accepted
- Date: 2026-10-26

## Context

All indexing, search and stats ran synchronously in the Electron main process. The main
process also serves every IPC call, so any long synchronous step freezes the whole app,
not just the screen that asked for it. On a real 5 GB corpus several steps take long
enough to notice: parsing a large session file (seconds), the substring search fallback
(a scan of every message body), and stats (aggregates over ~700k rows).

## Decision

Two `worker_threads`, each with its own better-sqlite3 connection to the same WAL
database:

- **Index worker** (`electron/indexWorker.ts`) — the only writer of index tables. Runs
  full scans and live file events from the main process's chokidar watcher (batched every
  300 ms), one job at a time, yielding between 2,000-line batches.
- **Query worker** (`electron/queryWorker.ts`) — `query_only`. Serves search, stats,
  transcripts, the prompts list and the files view.

The main process keeps only light work: lookups by id, user-data writes (favorites, tags,
templates, prices, settings), the export, and the watcher. It runs the schema migration
before either worker starts. Both connections use `timeout: 10 s` so a user-data write
waits for an index batch instead of failing; batches keep each write lock short.

## Consequences

- Positive: the window stays responsive during a full scan; measured main-IPC round trips
  are reported in `CHANGELOG.md`.
- Negative: three connections and a message protocol (`electron/workerProtocol.ts`)
  instead of direct calls; workers are separate Vite entries (`dist-electron/*Worker.cjs`).
- A crashed index worker is restarted up to three times; pending requests are rejected
  rather than left hanging.
