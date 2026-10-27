# Roadmap

## Status (2026-10-27)

**v0.6.0-beta.1 (2026-10-27) was the first public build**: an unsigned GitHub pre-release
for macOS (Apple Silicon, Intel), Windows and Linux. **v0.6.0-beta.2** followed the same
day as **ccStory**: Anthropic's guidelines keep "Claude" out of
third-party product names. Milestones v0.2.0–v0.3.2 were
development batches. v0.4.0 fixes the problems a real-corpus audit found — lost
favorites, a frozen window during active sessions, ~2× inflated token counts, no
pricing for current models, and the app discarding history Claude Code deletes — and
adds the prompts view, tag filtering, archive mode and Settings; v0.4.1 tightens prompt,
file and stats accuracy; v0.5.0 brings the UI in line with the owner's other tools
(ADR-0009). v0.5.1 moves to a supported Electron (44) and protects the only copy of
archived history with backups and startup recovery (ADR-0010). v0.6.0 gets the first
release ready:
- an end-to-end test, and unit and DB tests, on macOS, Windows and Linux;
- a release dry run that packages all three;
- app icons, plan archiving and OpenAI prices;
- a way to measure the go/no-go bar below.

See [CHANGELOG.md](../CHANGELOG.md).

| Phase | Goal | State |
|-------|------|-------|
| v0.4.0 — trust | Data that never silently disappears; numbers that are right; a window that never freezes | Done, needs owner dogfooding |
| v0.4.1 — accuracy | Prompt detection, file history and stats follow-ups found while measuring | Done |
| v0.5.0 — glass UI | One visual language with the owner's other tools; AA contrast in both themes | Done |
| v0.5.1 — durability | A supported runtime; backups and recovery for the only copy of archived history | Done |
| v0.6.0-beta.1 — first public build | A build other people can install | Published as an unsigned pre-release (2026-10-27) |
| v0.6.0-beta.2 — renamed to ccStory | The same build under a name that follows Anthropic's trademark guidelines | Published as an unsigned pre-release (2026-10-27) |
| Signed release | Developer ID + notarization, Windows certificate, Homebrew cask | When ~3 people outside the owner install it and come back (step 3 below) |
| Later | Only what users ask for | — |

### First-release checklist (whichever distribution path is chosen)

- [x] App icons in `build/` (`icon.icns`, `icon.ico`, `icon.png`, generated from `icon.svg`).
- [x] Release dry run packages macOS, Windows and Linux (`gh workflow run release.yml -f publish=never`).
- [x] End-to-end smoke test passes on all three (`npm run test:e2e`, in CI).
- [x] Version bump + tag (`npm version 0.6.0-beta.1`, tag `v0.6.0-beta.1`) — triggers `.github/workflows/release.yml`.
- [x] Release notes from CHANGELOG (`docs/release-notes/v0.6.0-beta.1.md`).
- [x] macOS builds open after download (ad-hoc signed, verified in the workflow), Intel and Apple Silicon.
- [ ] Signing secrets — deferred to step 3 below.

## Decision: public (2026-10-27)

The owner decided to go public without waiting for the four weeks of dogfooding below.
**Step 2, the free unsigned pre-release, is taken now** (v0.6.0-beta.1). The four-week
measure still matters: together with outside interest, it decides step 3, which is
paying for signing.

The original reasoning, kept for reference: the repository was already public, so the
real question was **how much to invest in distribution** — signing ($99/yr Apple
Developer Program, Windows certificate), support, Homebrew, testing on Windows/Linux.
Recommended path: **decide with data after four weeks of dogfooding, and validate demand
with a free step before paying for signing.**

1. **Weeks 1–4 — personal tool.** Use the current build daily. Go/no-go criteria:
   - you opened it on ≥3 days a week (Stats → "Days you opened Trove" shows each of the last
     four weeks; prompts-per-day measures Claude Code, not Trove);
   - it answered at least one "how did I do X?" you could not have answered otherwise
     (e.g. from an archived session);
   - no lost favorites, no frozen window, no wrong numbers on your corpus.
2. **If go — unsigned pre-release (free).** *Done: `v0.6.0-beta.1`.* A GitHub
   *pre-release* with "Privacy & Security → Open Anyway" install notes. No Homebrew, and
   no auto-update on macOS (that needs signing). Share it in one or two places Claude
   Code users read.
3. **Public OSS (paid) only if** at least ~3 people outside you install it and come back,
   or open issues. Then buy signing, add the secrets, submit the Homebrew cask.
4. **If no-go** — keep it a personal tool: drop the release pipeline and Homebrew notes,
   and lighten the process (ADRs for real decisions only; Issues optional).

Process today (ADRs, issue/PR templates, CI, release workflow) is sized for an OSS
project with contributors. For a personal tool it is overhead; for OSS it is a good base.
