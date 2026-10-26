# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Liquid-glass UI ([ADR-0009](docs/decisions/0009-glass-visual-system.md))

The interface now matches the owner's other tools instead of a generic console look:

- Translucent glass panels over a soft lit background; a floating icon rail (settings and
  theme in its footer) replaces the sidebar; a page header with a status pill (index
  state, ⌘K, re-index); a toast replaces the status bar.
- The project filter is a searchable picker in the toolbar (it used to take a third of
  the width as a permanent list).
- Search results, prompts, files, favorites and templates are rows inside glass panels;
  FTS hits are highlighted (`«…»` markers render as highlights).
- Stats: four stat tiles (prompts, sessions, messages, estimated cost), a prompts-per-day
  column chart with a continuous time axis, tooltip and table view, thin single-colour
  bars for models, roles and cost.
- Pretendard Variable is bundled (no network); light/dark follows the OS until chosen and
  is set before first paint; the switch spreads from the button where supported.
- Korean copy is 해요체 throughout and uses "색인" for indexing; the language switch moved
  to Settings.
- Template and archive deletion ask for a second click.
- Checked on the built app against a real 5 GB index, both themes, screenshots rendered
  in sRGB (`--force-color-profile=srgb`; without it macOS returns display-space pixels,
  e.g. #808080 → #757575): every measured text element ≥ 4.5:1 (lowest 4.73:1), with a
  #aaa-on-#fff control reading 2.32:1 as a self-check of the measurement. Idle CPU with
  the static background: 2.2% of one core (27% when the background drifted).

### Trust fixes from a real-corpus audit (2026-10-26)

Audited on one heavy user's machine: 46 projects, 855 transcripts, 5.2 GB, largest file
377 MB. Measured after the fixes with an end-to-end run of the built app against that
corpus (`VAULT_USER_DATA` pointed at a scratch dir):

| | Before | After |
|---|---|---|
| Favorites/tags after Claude Code appends to a session | deleted (`ON DELETE CASCADE` on re-insert) | kept — keyed by line `uuid` ([ADR-0006](docs/decisions/0006-stable-keys-append-indexing-archive.md)) |
| Favorites/tags after a schema upgrade | all deleted | kept; v8 data migrated to stable keys |
| Sessions Claude Code deletes (`cleanupPeriodDays`) | removed from the index too | kept as archived (default), purge is explicit |
| Re-index of an active 377 MB session | full re-read on every write, ~2.7 s parse + ~1 GB RSS on the main thread | only new bytes; transcript row ids stay stable |
| Main-process IPC during the full 5 GB scan | blocked for seconds | p50 0.4 ms / p95 4.3 ms / max 17.6 ms (scan: 65 s) |
| Token totals | 2.16× too high (usage repeated on every line of a response) | counted once per API response |
| Cost for `claude-opus-5` / `claude-opus-5-5` | unpriced → $0 shown | priced (table dated 2026-10-06), 1-hour cache writes at 2× |
| Codex CLI sessions | 100% of lines stored as `[response_item]` meta | parsed (messages, tools, usage), grouped by cwd |
| Restart with an existing index (871 files) | — | 5.6 s scan (unchanged files skipped) |
| Search latency, 746k messages (`npm run bench`) | not measured | typical p50 19 ms / p95 68 ms; no-hit worst case (substring scan) p50 308 ms / p95 720 ms on the query worker |
| Stats tab | full table scans on the main thread | ~180 ms on the query worker (covering indexes) |

### Added

- **Append-only indexing** with byte offsets and head/tail fingerprints; files read in
  4 MB chunks; 2,000-line write batches; half-written trailing lines are left for later.
- **Index and query worker threads** ([ADR-0007](docs/decisions/0007-worker-threads.md)):
  the main process only serves light IPC.
- **Archive mode** (Settings): keep or mirror deleted transcripts; archived badges in
  sidebar, results, recent sessions and the transcript modal; explicit purge.
- **My prompts** tab: human-typed prompts only (tool results, `isMeta` lines,
  `<task-notification>`, interruptions, continuation summaries, IDE context blocks
  excluded; slash commands rendered as `/name args`), deduplicated, recent / most used.
- **Tag filter**: click a tag in the inspector to filter (empty query lists everything
  tagged); tag counts, tag delete; no more per-result IPC to load tags.
- **Exclude tool output** search filter (on by default — tool output is ~40% of
  conversation rows); **substring fallback** when token search finds nothing (infix and
  CJK queries, [ADR-0008](docs/decisions/0008-fts-tokenizer.md)); bookkeeping lines kept
  out of the FTS index (built over a `messages_searchable` view).
- **Favorite toggle** in results and prompts; favorites keep a snapshot of the starred
  text and show whether the source is still there.
- **Settings** tab: archive mode, update checks on/off ([ADR-0005](docs/decisions/0005-update-check-network-exception.md)),
  DB path and size, "re-read all files".
- **Export to file** (save dialog; paths under `~/.claude` are refused) and a selected
  count with clear/export shortcuts.
- Cost: unpriced models listed by name; 1-hour cache-write column; new models seeded once
  on upgrade without overwriting edits (`PRICES_SEED_VERSION`).
- Project titles for slug-only projects (e.g. external volumes) come from the recorded `cwd`.
- `npm run test:db` (17 SQLite integration tests, also in CI and before releases) and
  `npm run bench` (search latency on an existing index).
- `VAULT_USER_DATA` override for disposable test profiles.
- Latest-wins search: while one search runs, only the newest waiting request is kept
  (older ones resolve to `null`); typing a word with no hits ran 2 of 8 requests (1.3 s
  total) instead of 8 full scans.

### Changed

- Parser: only `user` / `assistant` / `system` (or untyped legacy) lines are conversation;
  other typed lines (`api-request`, `api-request-blob`, `attachment`, `atis-latch`,
  `bridge-session`, …) are bookkeeping even when they carry a `message`, and never
  contribute usage. `isMeta` user lines are meta.
- Stats: tokens per API response; top words from my prompts; activity = prompts per
  local day; archived and prompt counts.
- Fuzzy (Fuse) re-ranking only applies to relevance sort and never drops FTS hits.
- `src/App.tsx` split into `src/tabs/`, `src/components/`, `src/ui.tsx`, `src/format.ts`.
- Hardcoded Korean strings in the inspector, transcript and plan views moved to i18n.
- The unused `messages.raw_preview` column is no longer written; the WAL is checkpointed
  after a full scan.

### Fixed

- The app created `~/.claude/projects` and `~/.claude/plans` on startup, contradicting the
  "never writes under ~/.claude" invariant. Missing roots are now polled until they appear.
- Deleted transcripts were ignored by the live watcher (`unlink` was dropped).
- `CLAUDE_HOME` pointing at a folder not named `.claude` silently disabled live updates.
- `LIKE` fallbacks stripped `%` / `_` instead of escaping them (`snake_case` could not be found).
- Prompts: user turns whose `turnOrigin` is `task_notification`, `peer` or `system` are
  never counted as typed prompts (independent of the text markers).
- Files: copies of API requests (`api-request-blob`) no longer add file touches, so an
  edit is not listed twice.
- Stats: compact numbers go through B/T (`27.7B`, not `27650.3M`); "words I use most"
  counts the prompts containing a word, so one pasted log no longer dominates.

### Earlier unreleased work

- **Search precision & sorting:** match modes (아무거나 OR / 모두 AND / 구문),
  quoted-phrase support in the query, sort by relevance/newest/oldest, and a date-range
  filter (전체/24시간/7일/30일) using real message timestamps. Result cards show timestamps.
- **Prompt templates:** a new 템플릿 tab with `{{variable}}` placeholders, live variable
  fill + preview, and 「템플릿 저장」 straight from a search hit (`shared/templates.ts`, unit-tested).
- **Background indexing:** the window paints first, then projects index one-per-macrotask
  with live progress events (`onIndexProgress`) shown in the header; watcher starts after the first pass.
- **Command palette (⌘/Ctrl+K):** jump to tabs, projects, and actions; arrow/Enter keyboard
  navigation of search results.
- **Markdown rendering** for plan bodies and assistant messages (react-markdown + GFM; toggle in the transcript modal).
- **Multi-tool adapters:** an adapter registry (`electron/adapters.ts`) with a Claude Code
  adapter and a Codex CLI adapter (`~/.codex/sessions`, inert when absent); `projects.tool`
  column and a source badge in the sidebar.
- **Light/dark theme toggle** (persisted) via a CSS-variable neutral scale.
- **Per-message metadata (schema v4):** parser now extracts `timestamp`, `model`,
  token `usage` (input/output/cache-read/cache-creation), and `isSidechain` from
  each JSONL line; stored on `messages` and repopulated by a one-time reindex on upgrade.
- **Real usage analytics** in the Stats tab: measured token totals, per-model
  breakdown (bar chart), and activity derived from actual message timestamps
  (falls back to session mtime for pre-v4 data).
- **Cross-platform packaging:** `win` (NSIS) and `linux` (AppImage) `electron-builder` targets.
- **CI:** GitHub Actions workflow (typecheck, lint, unit tests, renderer build).
- **Linting:** flat ESLint config (`eslint.config.js`) + `lint` / `typecheck` npm scripts.
- `messages.message_class` (`dialog` | `meta` | `other`) with schema migration.
- Richer JSONL parsing: `permission-mode`, `agent-name`, `custom-title`, `tool_result`, `thinking`, `last-prompt`, etc.
- Search filters: exclude meta lines (default on), exclude `subagents` paths.
- Empty search shows **recent sessions** list; keyword search unchanged.
- IPC: `recentSessions`, `ExportOptions` on `exportMessages`.
- Session transcript modal: **Esc** to close, focus on open, optional **show meta** toggle.
- Sidebar project labels: short path tail + full path tooltip.
- GitHub Issue forms under `.github/ISSUE_TEMPLATE/`.

#### Changed (earlier)

- Search with empty query returns no hit list (use recent sessions instead).
- Stats token counts exclude `meta` rows.
- PoC script prints `messageClass` histogram.

#### Fixed (earlier)

- **Live watch was broken on chokidar v4** (globs removed in v4): now watches the
  Claude/plans roots directly and filters by extension in the handler.
- **Stale rows:** `fullReindex` now prunes projects/sessions whose files no longer
  exist on disk (previously only plan files were pruned).
- **Build typecheck was silently misconfigured:** `tsconfig.node.json` had no
  `target` (defaulted to ES3), masking iteration/regex and a `db possibly null`
  error in the main process; added `target: ES2022` and fixed the null-narrowing bug.

## [0.1.0] — 2026-04-14

- Initial Electron + Vite + React app, SQLite FTS5, favorites, tags, export, DMG.
