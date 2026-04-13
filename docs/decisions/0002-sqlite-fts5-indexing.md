# ADR-0002: SQLite FTS5 indexing strategy

- Status: Accepted
- Date: 2026-04-14

## Context

We need fast offline full-text search across thousands of messages on disk. Alternatives: client-only grep (slow UX), embedded search engines (heavier deps), or SQLite FTS5.

## Decision

Use **better-sqlite3** with:

- Normal tables `projects`, `sessions`, `messages`.
- **FTS5** external content virtual table `messages_fts` pointing at `messages.body` with `content_rowid='id'`.
- SQL **triggers** on `messages` to keep FTS rows in sync.
- **Incremental** reindex: compare per-file `mtime` with `sessions.file_mtime_ms`; skip unchanged files.

Search uses FTS `MATCH` with token-prefix boolean queries; on failure, fall back to SQL `LIKE`.

## Consequences

- **Positive:** Mature query language, BM25 ranking, snippet support, single-file DB for app metadata + index.
- **Negative:** Native module complicates build (`electron-builder install-app-deps`, `asarUnpack` for `.node`).
- **Follow-up:** Consider background indexing queue if users report UI stalls on huge corpora.
