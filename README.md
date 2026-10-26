# Claude Vault

**Claude Vault** is a local-first desktop app that indexes your [Claude Code](https://www.anthropic.com/claude-code) conversation history, keeps it even after Claude Code deletes old transcripts, makes it searchable (SQLite **FTS5**), and helps you **reuse** your own prompts.

- **OS:** macOS first (Electron); `electron-builder` also targets Windows (NSIS) and Linux (AppImage/deb). Path logic works cross-platform; Windows/Linux are less battle-tested.
- **Privacy:** Claude's files are read-only — the app never writes under `~/.claude/`. The index and its backups live in a local SQLite DB under your user data directory. The only network request is an update check against GitHub Releases, which sends no conversation data and can be turned off in **Settings** ([ADR-0005](docs/decisions/0005-update-check-network-exception.md)).
- **License:** MIT — see [LICENSE](LICENSE).

![Version](https://img.shields.io/badge/version-0.1.0-blue)

## Screenshots

> 스크린샷 PNG를 `docs/images/`에 두고 여기에 링크하면 README에서 바로 보입니다.  
> 예: `![검색 화면](docs/images/search.png)`

## Features

| Area | Status |
|------|--------|
| Indexing of `~/.claude/projects` (root `{uuid}.jsonl`, `subagents/`, `agent-transcripts/`, `sessions-index.json`) and `~/.claude/plans` | Yes — append-only, on a background worker |
| **Archive**: sessions Claude Code deletes stay searchable (badged "보관됨"); purge is explicit | Yes (default on) |
| Full-text search + project / role / date / meta / subagents / **tool output** / **tag** filters | Yes |
| Match modes (OR / AND / phrase), sort (relevance / newest / oldest), substring fallback for infix & CJK | Yes |
| **My prompts**: what you typed, deduplicated, recent or most used | Yes |
| **Files**: which sessions touched a file, when, on which branch | Yes |
| Favorites and tags that survive re-indexing and upgrades | Yes |
| Session transcript modal (markdown, meta/tool toggles, archived banner) | Yes |
| Prompt templates with `{{variables}}` | Yes |
| Command palette (⌘/Ctrl+K), keyboard result navigation | Yes |
| Usage stats per model, counted **once per API response**; cost estimate with 5-minute / 1-hour cache writes and an editable, dated price table | Yes |
| Export Markdown / CSV — copy or save to a file | Yes |
| **Backups**: daily DB snapshots plus one before upgrades, purges and restores; restore in Settings; a DB that won't open is recovered from the newest backup | Yes (keeps 3) |
| Settings: archive mode, backups, update checks, data location, full re-read | Yes |
| Codex CLI sessions (`~/.codex/sessions`, grouped by working directory) | Best effort |
| Korean / English UI, light / dark theme | Yes |

## Documentation

See the [docs/](docs/README.md) directory (PRD, architecture, ADRs, roadmap, release process).

[CHANGELOG.md](CHANGELOG.md) — 변경 이력.

## Development

```bash
npm install
npm run dev
```

개발 중 DevTools를 자동으로 열고 싶다면(콘솔 잡음 로그가 터미널에 보일 수 있음):

```bash
VAULT_OPEN_DEVTOOLS=1 npm run dev
```

그렇지 않으면 메뉴 **보기 → 개발자 도구** 또는 macOS에서 **⌥⌘I**로 수동 실행하면 됩니다.

Other scripts:

- `npm run build` — typecheck, production Vite build, installer via `electron-builder`.
- `npm run typecheck` — main/preload/shared and the renderer.
- `npm run lint` — ESLint (flat config).
- `npm test` — unit tests (parsers, search helpers, pricing, IPC guards).
- `npm run test:db` — SQLite integration tests (indexing, archive, migrations, search, backups).
- `npm run test:e2e` — end-to-end smoke test: launches the built app (`npx vite build` first) against fixture transcripts and drives it with Playwright.
- `npm run bench -- <vault.db>` — search latency on an existing index.
- `npm run poc` — CLI scan of your transcripts with parser stats (no GUI, no DB).

Environment overrides: `CLAUDE_HOME`, `CODEX_HOME` (absolute paths), `VAULT_USER_DATA` (put the vault DB somewhere disposable), `VAULT_DISABLE_UPDATER=1`.

CI (GitHub Actions) runs typecheck, lint, unit tests, DB integration tests and the renderer build, plus the end-to-end smoke test on macOS, Windows and Linux, on every push/PR.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and ideas go to **GitHub Issues**; durable decisions go to `docs/decisions/` or [docs/issue-decisions.md](docs/issue-decisions.md).

## Disclaimer

This is an independent open-source tool, not affiliated with Anthropic. It reads files already stored on your machine by Claude Code; respect your own security policies when indexing work repositories. Cost figures are estimates from logged token counts and a user-editable price table, not billing data.
