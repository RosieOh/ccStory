# Claude Vault — PRD (v1.0 alignment)

## Vision

Turn Claude Code conversation history under `~/.claude/projects/` into a **searchable, reusable** local knowledge base. No cloud, no writes to Anthropic data directories.

Tagline: *Your Claude conversations. Instantly searchable. Always reusable.*

## Problem

- JSONL sessions accumulate per project; there is no official UI to browse or search them.
- Effective prompts and short commands are retyped or copied to external notes.
- Raw JSONL is hard to inspect without tooling.

## Target users

- Heavy Claude Code users (primary).
- Side-project / “vibe coding” users (growth).
- Team sharing of prompt libraries (v2).

## MVP scope (Phase 1)

| Priority | Feature | Notes |
|----------|---------|--------|
| P0 | JSONL parse + index | Read-only scan of `agent-transcripts/*.jsonl`, SQLite + FTS5 |
| P0 | Project list | Sidebar: folder name, session count, last modified |
| P0 | Full-text search | Keyword search; filters: project, role |
| P0 | One-click copy | Clipboard from message card |
| P1 | Favorites | Star prompts; list in Favorites tab |
| P1 | Tags | User tags on messages; toggle in UI |
| P1 | Live sync | chokidar on `**/*.jsonl` under projects root |
| P2 | Usage stats | Counts, rough token frequency, activity by day |
| P2 | Export | Markdown / CSV for selected messages |

## v2 backlog (Phase 2)

- Prompt template editor with variables.
- Team sharing (shared DB path or JSON export workflow).
- AI summarization and pattern suggestions.
- Multi-tool history (Cursor, Gemini CLI, Codex CLI) inspired by CCHV-style adapters.

## Non-goals (MVP)

- Editing or deleting Anthropic session files.
- Any network sync or telemetry.

## Success metrics (from planning doc)

- Search latency target: &lt; 200ms MVP, &lt; 100ms v1.0 on typical hardware.
- OSS health: resolve rate for open issues, Homebrew adoption after v1.0.
