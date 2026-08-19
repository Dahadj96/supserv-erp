# The Figma file has components now

**Date:** 2026-08-19
**File:** `p0zcsZTobPL8zZAeYhyYBt` — page `v4 - Complete`

## What was wrong

The 86 screens were drawn as flat frames. 18,449 frames, 12,691 text nodes,
**zero components and zero instances**. The app shell — sidebar and topbar —
was copy-pasted **79 times**. Renaming one nav item meant editing 79 copies,
and nobody would ever do that, so the screens would drift apart.

## What was done

A new page, `v5 - Components`, holds six components built by cloning the real
drawn elements, so nothing was redrawn or re-styled from guesswork:

| Component | Variants | Replaces |
|---|---|---|
| `Sidebar` | — | 79 hand-drawn sidebars |
| `Topbar` | — | 79 hand-drawn topbars |
| `Button` | Primary / Secondary / Ghost / Danger × Default / Hover / Focus / Disabled | the `btn:*` frames on screen 35 |
| `Badge` | Neutral, Critical | 237 count pills |
| `Checkbox` | Unchecked, Checked, Disabled | 81 boxes |
| `Toggle` | On, Off, Disabled | 37 switches |

All 79 screens now use `Sidebar` and `Topbar` instances. Each screen keeps its
own `page-header` and `content` untouched — the swap replaced only the two
chrome elements, and the screens' existing auto-layout put everything back in
the same place.

Per-screen state survived as instance overrides: the active nav row (fill
`#1A1A19`, label white, Geist SemiBold), the three nav badge counts, and the
breadcrumb text.

The `Sidebar` component stretches: its `filler` fills vertically, so the user
footer stays pinned to the bottom on screens from 1024 to 1784 px tall.

## What was deliberately not done

- **`panel` (311) and `tr` (298) were left alone.** Their internals differ per
  screen — column counts, widths, cell contents. One component would either
  lose content or need a component set per table, which is worse than leaving
  them. Revisit per screen when that screen is built.
- **10,781 frames are still named `Frame`.** That is the remaining debt. It
  costs nothing today and can be cleaned up screen by screen.
- **Code Connect was not set up.** It needs a Dev or Full seat on an
  Organization or Enterprise plan; this account is on Pro.

## Consequence for the code

The tokens in `SUPSERV Tokens` (39 variables — colour, radius, spacing) are the
source for the Tailwind theme. `Sidebar` and `Topbar` become one Next.js layout
under `src/app/[locale]/`, written once. `Button`, `Badge`, `Checkbox` and
`Toggle` become `src/components/`. No screen re-implements them — see law
"reuse, never rebuild" in `CLAUDE.md`.

## Open question

Four screens have no highlighted nav row: **26 - Personnel requests**,
**58 - Waiting on**, **82 - Search**, **86 - On the phone**. They had none
before the swap either — the componentisation surfaced it rather than caused
it. Search and On the phone are plausibly deliberate. The other two look like
an oversight and should be set.
