# ADR-0008: Keep the unicode61 tokenizer; add a substring fallback instead of trigram

- Status: Accepted
- Date: 2026-10-26

## Context

`messages_fts` uses FTS5's default `unicode61` tokenizer with prefix queries
(`"word"*`). Prefix matching already covers Korean particles ("검색" finds "검색을"),
but not matches inside a word ("색인" in "재색인"). The usual answer is the `trigram`
tokenizer, which matches any substring.

## Decision

Do not switch to `trigram`:

- Trigram cannot match a query shorter than three characters, and most Korean content
  words are two syllables ("검색", "색인", "버그") — the main audience's most common
  queries would stop matching.
- It multiplies the index size several times over the ~350 MB of searchable text on a
  real corpus.

Instead:

- Keep `unicode61` + prefix queries.
- When the token query finds nothing (or is malformed), fall back to an escaped
  `LIKE '%…%'` scan on the query worker, which finds infix matches at the cost of a
  slower search only in that case.
- Keep bookkeeping lines (70% of rows) out of the FTS index entirely (the index is built
  over the `messages_searchable` view), so the index holds only conversation.

## Consequences

- Infix and CJK-without-spaces queries work, just more slowly when they need the fallback.
  Measured on 746k messages: typical queries p95 68 ms; a query with no hits at all
  (full substring scan) p50 308 ms / p95 720 ms. It runs on the query worker, and
  latest-wins coalescing keeps typing from queueing one scan per keystroke. Single
  characters never trigger the scan.
- If a future SQLite build offers a tokenizer that handles two-character CJK terms well,
  revisit this ADR.
