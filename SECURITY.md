# Security

Trove is a **local-first** desktop app: it reads Claude Code data under your home directory (see `docs/architecture.md`) and stores an index in the app’s user data folder. It never writes under `~/.claude/`. **The only network request is the update check** against GitHub Releases (app version only, no conversation data), which can be turned off in Settings — see [ADR-0005](docs/decisions/0005-update-check-network-exception.md). The renderer runs with `connect-src 'none'`.

## Reporting

If you believe you have found a security issue (e.g. IPC abuse from a compromised renderer, path traversal in indexing), please open a **private** GitHub Security Advisory or contact the maintainers as described in the repository profile, with enough detail to reproduce.

## Threat model (short)

- **Renderer** is isolated (`contextIsolation`, no `nodeIntegration`). IPC is the main trust boundary.
- **Malicious local data**: JSONL or Markdown under `~/.claude` could be large or unusual. Files are streamed in chunks on a worker thread; IPC inputs are normalized in `electron/ipcGuards.ts` (search limits, ids, message keys, tag colors, export batch size, clipboard truncation). Rendered Markdown never emits raw HTML. The app is not hardened against hostile multi-gigabyte single lines beyond memory limits.
- **Exports**: written only to a path the user picks in a save dialog; paths under `~/.claude` are refused.

## Supply chain

Follow normal practices: verify `package-lock.json` / lockfile and keep the runtime on a supported line. Electron patches only its latest three major versions, so Dependabot (`.github/dependabot.yml`) checks `electron`, `electron-updater` and `better-sqlite3` monthly; other dependencies are upgraded deliberately. `npm audit` should report nothing for production dependencies.
