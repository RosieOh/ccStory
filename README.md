# Claude Vault

**Claude Vault** is a local-first desktop app that indexes your [Claude Code](https://www.anthropic.com/claude-code) conversation history under `~/.claude/projects/`, makes it searchable (SQLite **FTS5**), and helps you **reuse** prompts with one-click copy, favorites, tags, and export.

- **OS:** macOS first (Electron); `electron-builder` also targets Windows (NSIS) and Linux (AppImage). Path logic works cross-platform; Windows/Linux are less battle-tested.
- **Privacy:** No network calls; Claude files are read-only; app state lives in a local SQLite DB under your user data directory.
- **License:** MIT — see [LICENSE](LICENSE).

![Version](https://img.shields.io/badge/version-0.1.0-blue)

## Screenshots

> 스크린샷 PNG를 `docs/images/`에 두고 여기에 링크하면 README에서 바로 보입니다.  
> 예: `![검색 화면](docs/images/search.png)`

## Features

| Area | Status |
|------|--------|
| Indexing (root UUID `.jsonl`, `subagents/`, `agent-transcripts/`, `sessions-index.json`) | Yes |
| Full-text search + project/role + **메타 제외** + **서브에이전트 제외** | Yes |
| **검색 정밀도**(OR/AND/구문) · **정렬**(관련도/최신/오래된) · **기간 필터** | Yes |
| **최근 세션** 목록 (검색어 비울 때) | Yes |
| **세션 전체** 타임라인 모달 (Esc, 메타 토글, **마크다운 렌더링**) | Yes |
| **명령 팔레트**(⌘/Ctrl+K) + 결과 키보드 내비게이션 | Yes |
| **프롬프트 템플릿**(`{{변수}}` 채우기) | Yes |
| **멀티툴 어댑터**(Claude Code · Codex CLI) | Yes |
| **라이트/다크 테마** 전환 | Yes |
| Clipboard copy | Yes |
| Favorites | Yes |
| Tags on messages | Yes |
| Live file watch (`chokidar` v4, root-dir watch) | Yes |
| **실측 토큰 사용량 통계** (모델별 breakdown, 타임스탬프 기준 활동) | Yes |
| Usage stats + Markdown/CSV export (보내기 시 필터 옵션) | Yes |

## Documentation

See the [docs/](docs/README.md) directory (PRD, architecture, ADRs, roadmap, release notes for packaging).

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

- `npm run build` — production Vite build + installer via `electron-builder`.
- `npm run typecheck` — typecheck main/preload/shared and the renderer.
- `npm run lint` — ESLint (flat config).
- `npm test` — Vitest unit tests (parser, search-merge, IPC guards).
- `npm run poc` — CLI scan of `~/.claude/projects` with parser stats (no GUI).

CI (GitHub Actions) runs typecheck + lint + tests + renderer build on every push/PR.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and ideas go to **GitHub Issues**; durable decisions go to `docs/decisions/` or [docs/issue-decisions.md](docs/issue-decisions.md).

## Disclaimer

This is an independent open-source tool, not affiliated with Anthropic. It reads files already stored on your machine by Claude Code; respect your own security policies when indexing work repositories.
