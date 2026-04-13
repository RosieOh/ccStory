# ADR-0001: ADR record format

- Status: Accepted
- Date: 2026-04-14

## Context

We need lightweight, versioned decisions separate from ephemeral GitHub Issue chat.

## Decision

Use Markdown ADRs in `docs/decisions/` named `NNNN-short-title.md` with the following sections:

1. **Title** — `# ADR-NNNN: …`
2. **Status** — Proposed | Accepted | Superseded
3. **Date**
4. **Context** — forces and constraints
5. **Decision** — what we will do
6. **Consequences** — positive, negative, follow-ups

## Consequences

- Easy to grep and review in PRs.
- Slightly more friction than commenting only in Issues — mitigated by [issue-decisions.md](../issue-decisions.md) for tiny outcomes.
