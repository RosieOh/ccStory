# ccStory — PRD

## Vision

Keep every Claude Code conversation — including the ones Claude Code itself deletes —
searchable and reusable on your own machine. No cloud, no writes to Claude's data
directories.

Tagline: *Your Claude conversations. Instantly searchable. Never lost.*

## Problem

- Claude Code deletes old transcripts on its own schedule (`cleanupPeriodDays`). On a
  real machine audited 2026-10-26, nothing older than seven weeks was left of months of
  work. The history you most want to look up is exactly the history that disappears.
- There is no official UI to browse or search the JSONL sessions; raw files are hard to
  read (one heavy user: 855 files, 5.2 GB, largest 377 MB).
- Prompts that worked are retyped or copied into external notes. They are under 1% of
  transcript lines, buried under tool output and harness bookkeeping.

## Target users

- Heavy Claude Code users (primary) — hundreds of sessions, multi-GB history.
- Side-project / "vibe coding" users (growth).
- Codex CLI users who also use Claude Code (secondary; best-effort adapter).

## Jobs to be done (priority order)

1. **Keep it.** "Claude Code deleted last month's session — I still need it."
2. **Find it.** "How did I fix that build error?" — full-text search across everything.
3. **Reuse it.** "What was the prompt I used for reviews?" — my own prompts, deduplicated.
4. **Trace it.** "When did I last touch `App.tsx`, and why?" — the Files view.
5. **Understand it.** Usage and estimated cost per model — useful, but secondary and
   only worth showing if correct.

## Scope (v0.4.0 – v0.5.0)

| Priority | Feature | Status |
|----------|---------|--------|
| P0 | Read-only indexing of `~/.claude/projects` (+ plans, + Codex) | Done; append-only, off the main thread |
| P0 | Archive: keep sessions whose source file was deleted | Done (default on, purge in Settings) |
| P0 | Full-text search with filters (project, role, date, meta, subagents, tool output, tag) | Done; substring fallback for infix/CJK |
| P0 | Favorites and tags that survive re-indexing and upgrades | Done (stable keys + snapshots) |
| P0 | One-click copy | Done |
| P1 | My prompts view (deduplicated, recent / most used) | Done |
| P1 | Files view (file → sessions that touched it) | Done |
| P1 | Prompt templates with `{{variables}}` | Done |
| P1 | Live sync while Claude Code writes | Done |
| P2 | Usage stats and cost estimate (per response, 5m/1h cache writes) | Done |
| P2 | Export Markdown / CSV to clipboard or file | Done |
| P2 | Settings: archive mode, update checks, data location | Done |

## Non-goals

- Editing or deleting Claude Code's files. The app never writes under `~/.claude/`.
- Network sync or telemetry. The only network request is the update check (ADR-0005),
  which can be turned off.
- Team sharing and AI summarization (were v2 ideas; not planned until there are users
  asking for them).

## Success metrics

Measured locally — there is no telemetry. `npm run bench` reports search latency on an
existing vault DB; the Settings tab shows DB size.

| Metric | Target | How measured |
|---|---|---|
| Main-process IPC round trip during a full scan | p95 < 50 ms (measured 4.3 ms) | end-to-end run (CHANGELOG) |
| Search latency, typical queries, 5 GB corpus | p95 < 200 ms (measured 68 ms) | `npm run bench` |
| Favorites/tags lost across re-index or upgrade | 0 | `npm run test:db` |
| Sessions kept after Claude Code deletes them | 100% in Keep mode | `npm run test:db`, Settings count |
| Token totals vs per-response truth | exact | `npm run test:db` (dedupe test) |
| Owner dogfooding before any public release | 4 weeks, ≥3 days/week | self-reported (see roadmap) |
