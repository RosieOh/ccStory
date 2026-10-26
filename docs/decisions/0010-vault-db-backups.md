# ADR-0010: Full snapshots of the vault DB, with recovery at startup

- Status: Accepted
- Date: 2026-10-27

## Context

Since [ADR-0006](0006-stable-keys-append-indexing-archive.md), Keep mode (the default)
makes `vault.db` the only copy of every transcript Claude Code has deleted. Favorites,
tags and templates live only there too. Until now nothing protected that file:

- A DB that failed to open was renamed aside and an empty one was created, silently. The
  archive disappeared from the app, and getting it back meant SQLite surgery by hand.
- "Delete all archived" and schema migrations change data irreversibly.

On the audited machine the DB is about 790 MB.

## Decision

- **What:** a full `VACUUM INTO` snapshot. It is one read transaction, so it is
  consistent while the index worker and main keep writing. It is compact, and a restore
  is just a file swap. Snapshots go to `<userData>/backups/`, never under `~/.claude`.
  A partial export (user data and archived sessions only) would be smaller, but a
  restore would then depend on re-indexing and on the source files still existing.
- **When:**
  - Daily: after the first scan, then checked hourly.
  - Before a schema migration: a file copy before any connection opens, which is a free
    clone on APFS.
  - Before "Delete all archived": if that snapshot fails, the purge is refused.
  - Before a restore: the current DB is renamed into the folder, which costs nothing.
- **Where it runs:** on the index worker, queued with scans. Snapshotting ~1 GB on the
  main thread would freeze every IPC call for seconds (ADR-0007).
- **How many:** keep the newest 3 by default. Settings offers 0, 1, 3 or 7. 0 stops
  automatic snapshots and deletes none. Lowering the count prunes right away.
- **Disk guard:** a snapshot is skipped when free space is under 1.2× the DB size.
- **Restore:** two clicks in Settings. The chosen file is verified first (`quick_check`,
  vault schema, not newer than this build). Then every connection closes, the current DB
  becomes a `pre-restore` backup, the copy is installed and the app relaunches.
- **Startup recovery:** a DB that cannot be opened is quarantined (kept on disk), and
  the newest backup that verifies takes its place. Only when none does is an empty DB
  created. Either way the user is told, with the path of the quarantined file.

## Consequences

- Disk use is about 3× the DB size by default (≈2.4 GB on the audited machine). The
  Settings screen shows the total so the user can choose fewer.
- Measured with a 780 MB snapshot: about 2.5–3.3 s on the worker, while main-process IPC
  stayed at p95 ≤ 3.4 ms.
- Restoring rolls back user data (favorites, tags, templates) along with the index.
  Changes made after the snapshot are lost, except that transcripts still on disk are
  re-indexed on the next scan.
