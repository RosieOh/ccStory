# ADR-0009: Liquid-glass visual system

- Status: Accepted
- Date: 2026-10-26
- Replaces the "operator console" look (green accent, opaque zinc surfaces, 4–10px radii)

## Context

The owner's other tools share one visual language: translucent glass panels over a soft
lit space, a floating icon rail, a large page header with a status pill, stat cards
with light numerals, pill buttons and segmented controls, a single blue accent, the
Pretendard typeface, and plain, polite Korean copy (해요체). Trove looked
unrelated to all of them. Recurring preferences across those projects also apply here:
nothing that looks AI-generated, no emoji or decorative gradients on text, rows rather
than card grids, and screens checked by looking at them, not only by tests.

## Decision

- **Tokens** live in `src/index.css` (`--ink-1..4`, `--brand*`, `--glass-*`, `--line*`,
  `--well`, `--tone-*`) with separate light and dark values; `tailwind.config.js` maps
  `ink-*`, `brand`, `line`, `well`, `tone-*` onto them. Components use semantic classes
  (`glass`, `rail`, `page-header`, `stat`, `list`/`row`, `btn-*`, `seg`, `badge`,
  `input`, `dialog`, `toast`, `bubble-*`) rather than ad-hoc colour utilities.
- **Shell**: a floating glass rail (screens; settings and theme in its footer) replaces
  the sidebar; the project filter becomes a searchable picker in each toolbar; a toast
  replaces the status bar; the header pill shows index state, ⌘K and re-index.
- **Typeface**: Pretendard Variable (SIL OFL 1.1) is **bundled** from the `pretendard`
  package. The CSP allows fonts from the app only and the app makes no network requests.
- **Theme**: decided before first paint by `public/theme-init.js` (saved choice, else the
  OS); switching animates a circular reveal where View Transitions are available.
- **Motion budget**: the app stays open for hours, and anything moving behind
  `backdrop-filter` forces every glass layer to re-blur each frame. Measured idle on the
  search screen: drifting light orbs cost **27% of a core**; static, **0.2%** (the blur
  itself is ~free when nothing behind it moves). So the background is static; motion is
  limited to short transitions (page rise, menus, the rail droplet, the theme reveal) and
  `prefers-reduced-motion` disables those too.
- **Charts** follow single-series rules: one brand hue, thin bars with a 4px rounded end
  at the value, hairline gridlines, values in text colours, and a table view for the
  activity chart so no value is hover-only.
- **Copy**: Korean UI strings use 해요체; "색인" is the one term for indexing.

## Consequences

- Visual changes are verified on rendered screenshots in both themes, and text contrast
  is measured from pixels (see the end-to-end check described in `CHANGELOG.md`).
- Never animate anything behind the glass continuously; re-measure idle CPU after adding
  any persistent motion.
- Any new colour goes into the token block for both themes; plain Tailwind palette
  colours (`zinc-*`, `emerald-*` …) should not appear in components.
