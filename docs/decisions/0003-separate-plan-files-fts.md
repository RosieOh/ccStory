# ADR 0003: Separate FTS for plan Markdown files

## Status

Accepted

## Context

Claude stores session transcripts as JSONL under `~/.claude/projects` and plan documents as Markdown under `~/.claude/plans`. Session text already lives in `messages` / `messages_fts`. Plan files are separate filesystem objects with different columns (title, full markdown body, file path).

## Decision

Introduce `plan_files` and `plan_files_fts` as a dedicated FTS5 external-content pair, mirroring the existing `messages` / `messages_fts` trigger pattern, instead of folding plans into `messages`.

## Consequences

- **Positive**: Simpler queries, no fake `session_id` for plans, independent ranking/snippets (`snippet(plan_files_fts, …)` on title+body), and clear separation when merging search results in the UI by `scope`.
- **Negative**: Two FTS maintenance paths and slightly larger schema; unified “all sources” search merges two result sets in application code (with a combined sort).
