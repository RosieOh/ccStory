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

`npm test` runs Vitest unit tests under `tests/` (parsers, IPC guards, search helpers, pricing). `npm run test:db` runs the SQLite integration tests under `tests/db/` (indexing, archive, migrations, search) inside Electron in Node mode. Add or extend tests when changing parsing, indexing, search, migrations, or IPC validation.

`better-sqlite3` is a native module; if Electron fails to load it after a version bump, run:

```bash
npm run postinstall
```

## Code style

- TypeScript strict mode.
- Prefer explicit types on exported APIs (`shared/ipc.ts`).
- Keep the renderer behind `window.vault`; only the main process and its workers touch the filesystem and SQLite. Long-running work goes on a worker, not the main thread.
- User-visible strings go through `shared/i18n.ts` (Korean is the source; English is required by the type).

## Pull request checklist

- [ ] `npm run build` passes (or explain platform-specific skips).
- [ ] `npm test` passes for logic changes in `shared/`, `electron/search`, or `electron/ipcGuards`.
- [ ] `npm run test:db` passes for changes to indexing, the schema, search SQL, or queries.
- [ ] User-visible strings added to both `ko` and `en` in `shared/i18n.ts`.
- [ ] Linked Issue or ADR where applicable.

## Code of conduct

Be respectful and assume good intent. For a formal policy, we can adopt Contributor Covenant when the maintainer group agrees.
