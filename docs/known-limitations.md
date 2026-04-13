# Known limitations

## JSONL schema drift

Claude Code may change JSONL field names or `content` shapes. The parser is defensive, but unknown shapes may produce empty or generic bodies. **Mitigation:** extend `shared/jsonlParse.ts`, bump `meta.schema_version` / migration notes, document new kinds here.

## Session layout assumptions

Claude Code layout varies by version. This app walks shallow `*.jsonl` trees and reads `sessions-index.json` when present. If a future version stores only opaque blobs outside these patterns, extend `electron/claudeLayout.ts` (see v2 multi-tool support in [PRD.md](PRD.md)).

## Large files

Very large JSONL files are read synchronously during indexing. Expect temporary UI stall on huge sessions; future work: streaming parser + background jobs.

## Platform

Primary target is **macOS**. Electron and path logic should work on Windows/Linux, but paths like `~/.claude/projects` and packaging are not fully validated on those OSes yet.

## Legal / ToS (high level, not legal advice)

Local read of your own files is the design center. Monitor upstream terms for Claude Code storage locations and acceptable use. This app does not reverse engineer network APIs.

## Code signing

Release builds may be unsigned by default; macOS Gatekeeper may require explicit approval to open the DMG.

## Unit tests vs `better-sqlite3`

`better-sqlite3` is built for **Electron’s Node ABI** during `npm run build` / `postinstall`. `npm test` (Vitest) runs under the **system Node** binary, so opening a real SQLite DB in tests can fail with NODE_MODULE_VERSION mismatch. Parser and pure search-merge tests avoid loading the native module; full DB integration tests would need a rebuild target or a separate in-process Electron test runner.
