# ADR-0005: The update check is the only network request, and it can be turned off

- Status: Accepted
- Date: 2026-10-26

## Context

`CLAUDE.md` says: *no telemetry — do not add network calls without an explicit,
reviewed ADR.* `electron-updater` was added (`electron/updater.ts`) without one, and the
README still said "No network calls". For a tool whose whole pitch is "your transcripts
never leave the machine", an undocumented outbound request is a trust problem even
when it carries no user data.

At the same time, updates matter more for this app than for most: the JSONL parser
tracks a format Claude Code changes without notice (v0.4.0 alone had to learn a dozen new
line types). A user stuck on an old build silently gets worse search and wrong stats.

## Decision

- The update check is the **only** network request the app makes. It asks the GitHub
  Releases feed (`RosieOh/ccStory`) for `latest*.yml`; the request carries the app
  version and the usual HTTP metadata (IP, user agent) and **no conversation data,
  paths, or usage**.
- It is **on by default** in packaged, signed builds and **off-switchable** in
  Settings → Update checks (`setting.autoUpdate` in the `meta` table). When off, the
  updater module is not even loaded and no request is made. `VAULT_DISABLE_UPDATER=1`
  still force-disables it.
- Downloading may happen in the background; **installing always waits for the user**.
- The renderer stays at `connect-src 'none'`; the request is made by the main process.
- Any further network feature needs its own ADR.

## Consequences

- README and SECURITY.md state the exception precisely instead of claiming "no network".
- Default-on keeps parser fixes reaching users; the switch keeps the privacy promise
  checkable by the user.
- Unsigned builds (the current state — see `docs/release.md`) cannot auto-update on
  macOS, so in practice no request succeeds until signing is set up.
