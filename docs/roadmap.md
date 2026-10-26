# Roadmap

## Status (2026-10-26)

No build has been released yet (no tag, no GitHub Release); milestones v0.2.0–v0.3.2
were development batches. v0.4.0 fixes the problems a real-corpus audit found — lost
favorites, a frozen window during active sessions, ~2× inflated token counts, no
pricing for current models, and the app discarding history Claude Code deletes — and
adds the prompts view, tag filtering, archive mode and Settings; v0.4.1 tightens prompt,
file and stats accuracy. See [CHANGELOG.md](../CHANGELOG.md).

| Phase | Goal | State |
|-------|------|-------|
| v0.4.0 — trust | Data that never silently disappears; numbers that are right; a window that never freezes | Done, needs owner dogfooding |
| v0.4.1 — accuracy | Prompt detection, file history and stats follow-ups found while measuring | Done |
| v0.5.0 — glass UI | One visual language with the owner's other tools; AA contrast in both themes | Planned |
| First release (v0.6.0) | A build other people can install | Blocked on the distribution decision below |
| Later | Only what dogfooding or real users ask for | — |

### First-release checklist (whichever distribution path is chosen)

- [ ] App icons in `build/` (`icon.icns`, `icon.ico`, `icon.png`) — the installer ships Electron's default icon today.
- [ ] Version bump + tag (`npm version minor`) — triggers `.github/workflows/release.yml`.
- [ ] Release notes from CHANGELOG `[Unreleased]`.
- [ ] Signing secrets (only on the public path, see below).

## Open decision: personal tool or public OSS?

The repository is already public; the real question is **how much to invest in
distribution** — signing ($99/yr Apple Developer Program, Windows certificate), support,
Homebrew, testing on Windows/Linux. The work above is the same either way, so
nothing is blocked on deciding now.

Recommended path: **decide with data after four weeks of dogfooding, and validate demand
with a free step before paying for signing.**

1. **Weeks 1–4 — personal tool.** Use the current build daily. Go/no-go criteria:
   - you opened it on ≥3 days a week (the Stats tab's prompts-per-day helps you check);
   - it answered at least one "how did I do X?" you could not have answered otherwise
     (e.g. from an archived session);
   - no lost favorites, no frozen window, no wrong numbers on your corpus.
2. **If go — unsigned pre-release (free).** Publish `v0.6.0-beta` as a GitHub
   *pre-release* with "right-click → Open" install notes. No Homebrew, no auto-update
   (it requires signing anyway). Share it in one or two places Claude Code users read.
3. **Public OSS (paid) only if** at least ~3 people outside you install it and come back,
   or open issues. Then buy signing, add the secrets, submit the Homebrew cask.
4. **If no-go** — keep it a personal tool: drop the release pipeline and Homebrew notes,
   and lighten the process (ADRs for real decisions only; Issues optional).

Process today (ADRs, issue/PR templates, CI, release workflow) is sized for an OSS
project with contributors. For a personal tool it is overhead; for OSS it is a good base.
