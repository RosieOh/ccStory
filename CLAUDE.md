# CLAUDE.md — hints for Claude Code contributors

This repository is the **Claude Vault** Electron + React app. Use this file as a quick orientation when you are the coding agent.

## Commands

- `npm run dev` — Vite + Electron with HMR for the renderer. DevTools는 기본 비활성(터미널 DevTools 잡음 방지). 필요 시 `VAULT_OPEN_DEVTOOLS=1 npm run dev`.
- `npm run build` — Typecheck project refs, Vite production build, `electron-builder` DMG.
- `npm run poc` — Standalone scan of `~/.claude/projects` + parser stats.

## Layout

- `electron/` — main process, preload, indexing, SQLite, IPC handlers.
- `src/` — React UI (Tailwind). Uses `window.vault` from preload; types in `src/vite-env.d.ts`.
- `shared/` — JSONL parser + IPC DTOs imported by both main and renderer type-only paths.
- `docs/` — PRD, architecture, ADRs, roadmap, release process.

## Invariants

- **Never write** under `~/.claude/` — read-only indexing only.
- **No telemetry** — do not add network calls without an explicit, reviewed ADR.
- **SQLite migrations** — bump schema carefully in `electron/db.ts` and document in `docs/architecture.md`.

## Where to start an Issue fix

- Search problems → `electron/search.ts` and FTS triggers in `electron/db.ts`.
- Missing messages → `shared/jsonlParse.ts` and a fixture line in a test or PoC output.
- UI regressions → `src/App.tsx` (monolith for now; split when a second screen stabilizes).
