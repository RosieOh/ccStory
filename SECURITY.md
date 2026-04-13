# Security

Claude Vault is a **local-first** desktop app: it reads Claude Code data under your home directory (see `docs/architecture.md`) and stores an index in the app’s user data folder. **It does not open remote network APIs for indexing or search** in the shipped design.

## Reporting

If you believe you have found a security issue (e.g. IPC abuse from a compromised renderer, path traversal in indexing), please open a **private** GitHub Security Advisory or contact the maintainers as described in the repository profile, with enough detail to reproduce.

## Threat model (short)

- **Renderer** is isolated (`contextIsolation`, no `nodeIntegration`). IPC is the main trust boundary.
- **Malicious local data**: JSONL or Markdown under `~/.claude` could be large or unusual; the app applies size limits on some IPC paths (e.g. export ID count, clipboard truncation) but is not hardened against hostile multi-gigabyte files beyond OS limits.

## Supply chain

Follow normal practices: verify `package-lock.json` / lockfile, pin Electron and native deps when possible, and rebuild after upgrades (`npm run postinstall` for `better-sqlite3`).
