# Reachable had to mean reachable by hand

**Date:** 4 September 2026
**Status:** decided and built — amends
`docs/DECISIONS/2026-08-26-four-screens-on-a-phone.md`

## What the Gérant asked for

> "I want to be able to use the ERP on mobile."

## What the August decision actually promised

Screen 86's rule stands and is not being reversed:

> Capture and approve on the phone. Build and decide on the laptop.

Under it was a second sentence, and that is the one that failed:

> **No route is blocked on a phone.** Everything else is still reachable and
> still readable — it simply is not pretending to have been designed for 390px.

"Reachable" was asserted, never measured. Measured on 4 September, at 390 × 844,
across all 86 routes:

- **Every single one scrolled sideways.** Between 3px and 67px of horizontal
  overflow, on every page — the state a phone shows as a page that slides under
  your thumb and springs back.
- **Twenty of the twenty-four destinations had no door.** The rail is
  hidden below `md` and the bottom bar holds four jobs, so `/deals`,
  `/invoices`, `/projects` and the rest were reachable only by somebody willing
  to type a URL. That is not reachable; that is a URL.

Both were true the day the August decision was written. Nobody had opened the
thing on a phone.

## What changed

**The same navigation, in a shape a phone can hold.** `nav-list.tsx` now draws
the twenty-four destinations, and both the rail and a new drawer render it —
not a phone menu and a laptop menu, which is two places for "which row is
active" to be decided differently. The drawer opens from the topbar, closes on
navigation and on Escape, and holds the page still underneath.

**The gutters got a breakpoint.** `px-7` is 28px a side: a margin at 1366, and
14% of a 390px screen spent on nothing. 261 of them across 65 files became
`px-4 md:px-7`. Nothing above `md` moved a pixel.

**Grids collapse, and their children collapse with them.** 103 bare
`grid-cols-N` / `col-span-N` across 48 files became responsive. The `col-span`
half is the one that mattered: a child spanning two columns inside a grid
collapsed to one does not clamp — CSS Grid creates an implicit second column
and pushes the page sideways. That was most of the measured overflow.

**Tables keep their columns and slide.** The shared `DataTable` was `w-full`,
so six columns squeezed into 390px, wrapped every cell to three lines and cut
the last column off. It is now `min-w-[760px] md:min-w-0` inside the card that
already scrolled: legible columns you slide to beat illegible columns you
cannot. Above `md` it is the container's width, exactly as before.

**Phone job #2 got built.** `/prices/new` — at a counter, writing down a price,
with no enquiry open. It was drawn in August, marked `phase: 4`, and the bottom
bar had been showing "Prix — phase 4" ever since; phase 4 shipped without it,
so the bar was promising something that was not coming. It exists now, and the
four are four.

The schema had been ready the whole time: `price_quote_has_a_subject` accepts a
DESIGNATION as the subject, and `deal_id` is nullable because "a price with no
deal is a catalogue price and serves every future enquiry". `capturePrice`
writes exactly that row. It reaches the offer builder through `priceHistory`,
which matches on the wording — so a price written down in a shop in September
answers "what did this cost last time" on an offer built in November, with
nobody having filed it anywhere.

## What did NOT change

**The rule.** Four routes are DESIGNED for 390. The offer builder is not one of
them and is not becoming one: it now fits on a phone without breaking, which is
not the same as being good there, and the difference is the whole of screen 86.
`isPhoneRoute` still answers "was this designed for a phone", never "may this be
opened on one".

**No separate mobile app, no separate routes, no separate components.** One
system, two shapes. Every change above is a breakpoint on an existing element.

## The measure

`pnpm shots` gained a `phone-390x844` viewport, first of the three, so a phone
regression is caught the same way the 12-inch laptop's were. The harness also
learned something it had wrong: an element inside a box with `overflow-x: auto`
is not spilling, it is content you slide to. Before that fix it reported every
cell of every list as a defect, which is how a measurement stops being read.

After: **0 pages with horizontal overflow, at 390, on all 86 routes.**

## Touch targets

The harness counts interactive elements under 24px tall. On the first phone
pass there were **670** across the 87 routes. Two thirds of them were one of
four things, and all four were fixed where they are defined rather than where
they appear:

- the tick box — 15px, in every list, 160 of them — is 24px on a phone and its
  drawn 15px from `md` up;
- the search field's input was 18px inside a 34px frame, so the half of the box
  above and below the words focused nothing;
- the row's own name in `DataTable` is now a block filling its cell, which is
  what people already expect of a list;
- two hand-rolled tick boxes and two pill toggles that never went through the
  shared components.

Two of the counts were the harness being wrong rather than the interface, and
those were fixed too: a `sr-only` input driven by a visible label is not a
small target, and a link wrapped around a button is as big as the button.

**670 → 86.** What is left is 74 links inside sentences and 12 buttons; a link
inside a sentence cannot be 36px tall without the sentence looking broken, so
that is where this stops.
