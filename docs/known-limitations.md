# Known limitations

## JSONL schema drift

Claude Code changes JSONL line types and `content` shapes without notice (a 2026-10 audit
found a dozen new top-level types). The parser treats any typed line other than
`user` / `assistant` / `system` as bookkeeping, so new types degrade to hidden meta rows
rather than polluting search — but genuinely new *conversation* shapes may still parse as
empty or generic bodies. **Mitigation:** run `npm run poc`, extend `shared/jsonlParse.ts`,
and use Settings → "re-read all files" (or `requestFullReparse` in a migration). Updates
matter for this reason (ADR-0005).

## Prompt detection is heuristic

"My prompts" excludes text the harness writes into user turns using known markers
(`<task-notification>`, `[Request interrupted…`, continuation summaries, IDE context
blocks, `isMeta`). A new harness marker shows up as a prompt until it is added to
`NOT_HUMAN_PROMPT`.

## Archive growth

In Keep mode the vault DB only grows: about 800 MB for 5.5 GB of transcripts on the
audited machine (parsed text, FTS index, metadata). Settings shows the size; "Delete all
archived" removes archived sessions (favorites keep their snapshots).

Backups are full snapshots, so the default of three takes about 3× the DB size on top
(≈2.4 GB on the audited machine). Settings shows the total and lets you keep 1 or turn
automatic backups off (ADR-0010).

## Codex CLI support is best effort

The Codex rollout format is undocumented; the adapter maps `response_item` messages, tool
calls/outputs and `token_usage_record` usage, and groups sessions by `session_meta.cwd`.
Codex files are re-read from the start on change (the format is stateful). OpenAI model
prices are not seeded — those models show as "unpriced" until you add rows.

## Search

- FTS5 `unicode61` tokens with prefix matching; matches inside a word use a slower
  substring scan that only runs when token search finds nothing (ADR-0008).
- Bookkeeping lines are not in the FTS index; "include meta" adds them with a substring
  scan.

## Cost estimates

Estimates from logged token counts × an editable price table dated `PRICES_AS_OF`. Not
modeled: Haiku 5.5's >100K-token prompt tier, batch/priority discounts, fast mode, and
subscription plans (usage under a subscription is not billed per token, so the figure is
an API-rate equivalent, not what you paid).

## Platform

Primary target is **macOS**. Electron and path logic should work on Windows/Linux, but
packaging and the worker threads are not validated there yet.

## Running from inside VS Code

VS Code's extension host exports `ELECTRON_RUN_AS_NODE=1`. A terminal or tool launched
from it that starts Electron will start it as plain Node instead of the app. Unset the
variable (`env -u ELECTRON_RUN_AS_NODE npm run dev`) if the window never appears.

## Legal / ToS (high level, not legal advice)

Local read of your own files is the design center. Monitor upstream terms for Claude Code
storage locations and acceptable use. This app does not reverse engineer network APIs.

## Code signing

Release builds are unsigned until signing secrets exist (see `docs/release.md`); macOS
Gatekeeper requires explicit approval, and auto-update does not work unsigned.

## Native module

`better-sqlite3` (13.x) ships N-API prebuilds for macOS, Windows and Linux (x64/arm64),
so nothing is compiled on install and the same binary loads in Node and Electron. Other
platforms fall back to a source build, which needs a C++ toolchain.
