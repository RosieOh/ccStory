# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

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

## [0.1.0] — 2026-04-14

- Initial Electron + Vite + React app, SQLite FTS5, favorites, tags, export, DMG.
