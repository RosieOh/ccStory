# Contributing to Claude Vault

Thank you for improving Claude Vault. This project values small, reviewable changes that match existing style.

## Workflow

1. **Open an Issue** (or comment on an existing one) before large refactors so direction is agreed.  
   Use the templates under [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/) when possible.
2. **Branch** from `main` with a descriptive name (`fix/search-fts-escape`, `feat/template-editor`).
3. **Implement** with tests or manual verification steps in the PR description.
4. **Document** significant behavior or architecture changes in `docs/` (see below).

## Documentation rules

- **GitHub Issues** — bugs, feature discussion, questions, long threads.
- **`docs/decisions/`** — ADRs for architectural choices (new DB tables, IPC shape, indexing strategy).
- **`docs/issue-decisions.md`** — one-line outcomes that must survive Issue closure (with Issue link).

## Local setup

```bash
npm install
npm run dev
npm test
```

`npm test` runs Vitest unit tests under `tests/` (parser, IPC guards, search helpers). Add or extend tests when changing parsing, search, or IPC validation.

`better-sqlite3` is a native module; if Electron fails to load it after a version bump, run:

```bash
npm run postinstall
```

## Code style

- TypeScript strict mode.
- Prefer explicit types on exported APIs (`shared/ipc.ts`).
- Keep the main process the only place that touches the filesystem and SQLite; renderer goes through `window.vault`.

## Pull request checklist

- [ ] `npm run build` passes (or explain platform-specific skips).
- [ ] `npm test` passes for logic changes in `shared/`, `electron/search`, or `electron/ipcGuards`.
- [ ] User-visible strings: English or Korean is fine for now; prefer clarity over volume.
- [ ] Linked Issue or ADR where applicable.

## Code of conduct

Be respectful and assume good intent. For a formal policy, we can adopt Contributor Covenant when the maintainer group agrees.
