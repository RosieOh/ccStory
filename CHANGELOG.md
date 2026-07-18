# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

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

### Changed

- Search with empty query returns no hit list (use recent sessions instead).
- Stats token counts exclude `meta` rows.
- PoC script prints `messageClass` histogram.

### Fixed

- **Live watch was broken on chokidar v4** (globs removed in v4): now watches the
  Claude/plans roots directly and filters by extension in the handler.
- **Stale rows:** `fullReindex` now prunes projects/sessions whose files no longer
  exist on disk (previously only plan files were pruned).
- **Build typecheck was silently misconfigured:** `tsconfig.node.json` had no
  `target` (defaulted to ES3), masking iteration/regex and a `db possibly null`
  error in the main process; added `target: ES2022` and fixed the null-narrowing bug.

## [0.1.0] — 2026-04-14

- Initial Electron + Vite + React app, SQLite FTS5, favorites, tags, export, DMG.
