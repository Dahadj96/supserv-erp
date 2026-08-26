# Four screens on a phone, and the rest on a laptop

**Screen 86. 2026-08-26.**

Screen 86 is a reference screen — it has no route. It answers what a phone is
for, and that answer governs every screen built afterwards, so it is written
down here and encoded in `src/mobile.ts` rather than left as a memory of a
Figma frame.

## The rule

> **Capture and approve on the phone. Build and decide on the laptop.**
> Same data, same records, same permissions — one system, two shapes.

## The four

| # | On the phone | Screen | Route | State |
|---|---|---|---|---|
| 1 | In a shop, photographing a product | 61 | `/capture` | built |
| 2 | At the counter, writing down a price | 74 | `/prices/new` | phase 4 |
| 3 | Approving from anywhere | 65 | `/approvals` | phase 6 |
| 4 | Reading, not writing — Today | 55 | `/today` | phase 6 |

Eighty-five frames are 1440 wide. These four are 390.

## Why not the other eighty-two

The frame's own argument, and it is the right one:

- **What a phone is genuinely better at:** being in the room. A camera in a
  shop, a price at a counter, a signature on a site, a yes in a car. All four
  are capture or decision — seconds of input, no typing.
- **What it is worse at:** fourteen lines of pricing, a comparison of three
  suppliers, a cahier des charges of thirty-eight pages. Shrinking those onto a
  phone produces something nobody uses twice.

The failure mode this avoids is the usual one: a responsive ERP where every
screen technically fits and none of them is usable, which costs months and is
then abandoned. Four screens designed for a phone beats eighty-six squeezed
onto one.

## What was built now

Only #1 exists, because only #1 is in phase 2. What shipped with it:

- `src/mobile.ts` — the four as data, each with the phase that brings it. A
  fifth cannot appear without somebody adding a line and a reviewer reading it.
- The rail (236px, twenty-eight destinations) is hidden below `md`. A bottom
  bar takes its place showing all four — the three unbuilt ones greyed with
  their phase, the same honesty screen 38 applies to channels. A bar that grows
  from one button to four over six months looks broken twice; a bar that says
  what is coming looks like a plan.
- `/capture` stacks to one column below `sm`.

## What was deliberately NOT done

**No route is blocked on a phone.** Everything else is still reachable and
still readable — it simply is not pretending to have been designed for 390px.
Refusing to render the offer builder on a phone would be the system deciding
what somebody may look at from a car, which is not its business. `isPhoneRoute`
answers "was this designed for a phone", never "may this be opened on one".

**No separate mobile app, no separate routes, no separate components.** One
system, two shapes. A second implementation of the offer builder is a second
place for the totals to be wrong.

## The test

`tests/unit/mobile.test.ts` asserts the list is the four the frame draws, that
`built: true` is only claimed for a route whose page file exists, and that
prefix matching does not let `/captures-report` acquire a phone layout.
