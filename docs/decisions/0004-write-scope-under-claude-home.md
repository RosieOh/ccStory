# ADR-0004: Narrow the "never write under `~/.claude/`" invariant to the indexed roots

- Status: Accepted
- Date: 2026-07-22

## Context

`CLAUDE.md` has carried an absolute invariant since the first commit:

> **Never write** under `~/.claude/` — read-only indexing only.

The intent was always about **data safety**: Claude Vault indexes transcripts it
does not own, and a bug in the indexer must never corrupt or delete a user's
conversation history. Read-only access to the indexed data makes that failure
mode structurally impossible.

Stated as an absolute path prefix, though, the rule also forbids things that
carry none of that risk. The immediate case is the `/ingest` skill, which
summarizes a Claude Code session into an Obsidian vault. A Claude Code skill
*must* live at `~/.claude/skills/<name>/` — that is the only location the
runtime loads user-level skills from. There is no alternative placement, so the
rule as written blocks the feature outright, for reasons that do not apply to it:
`~/.claude/skills/` is configuration the user installs deliberately, not
transcript data we index.

Two options were considered:

1. Keep the invariant absolute, ship the skill files in-repo, and make the user
   copy them into place by hand.
2. Narrow the invariant to the roots that actually hold indexed data.

Option 1 preserves the letter of the rule but degrades a one-command install into
a manual, error-prone one, and it does so to protect a directory that was never
at risk.

## Decision

Narrow the invariant to the **indexed roots** rather than all of `~/.claude/`:

> **Never write** under `~/.claude/projects/` or `~/.claude/plans/` — these hold
> the user's transcripts and plans, and Vault only ever reads them.

Consequences of the narrowing:

- The **Vault application** still never writes anywhere under `~/.claude/`. This
  ADR does not relax anything about the app, the indexer, or the file watcher.
  Its DB stays in `app.getPath('userData')`.
- Writes elsewhere under `~/.claude/` are permitted only for **user-installed
  tooling**, and only when the user has explicitly asked for the install.
- Anything written must be **outside the indexed roots**, so it can never be
  picked up as transcript data and can never be confused with it.

## Consequences

**Positive**

- `/ingest` can be installed the normal way, to the only path that works.
- The rule now states its actual reason, so future cases can be judged on intent
  instead of on a path prefix.
- The protection that mattered — transcripts and plans are read-only — is
  unchanged and now stated precisely.

**Negative**

- `~/.claude/` is no longer a single blanket "do not touch" in the codebase's
  mental model; contributors must know which subtrees are off limits. Mitigated
  by naming the two roots explicitly in `CLAUDE.md` rather than describing them.
- A future subdirectory of `~/.claude/` holding user data would need to be added
  to the protected list deliberately.

**Follow-ups**

- `CLAUDE.md` invariant updated to the narrowed wording.
- If Vault ever gains a feature that writes under `~/.claude/`, it needs its own
  ADR — this one covers user-installed tooling only.
