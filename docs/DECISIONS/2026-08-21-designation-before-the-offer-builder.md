# Screens 73 and 75 ship as domain, not as screens

**Date:** 2026-08-21
**Screens:** 73 (Item list builder), 75 (Which name goes on the offer)

## The problem

`docs/PLAN.md` puts screens 73 and 75 in phase 1, alongside `item` and
`item_alias`. But both screens live inside a deal:

- 73 is `/deals/[id]/items`
- 75 is `/deals/[id]/prices` — it is drawn as *Designations — building the offer
  for ENQ-2026-0142*, with a supplier quote in the middle column

Deals, supplier quotes and offer lines are phase 4. Building either screen now
would mean inventing an enquiry to hang it on, and CLAUDE.md is explicit that
nothing here ships with sample data.

## The decision

Split each screen where the phase boundary actually falls.

**Phase 1 — built now, in `src/domain/`:**

- `designation.ts` — the four rules (client / supplier / combined / ours), the
  verdict a line gets (`same`, `ruleApplied`, `differs`, `ours`), and the
  normalisation that decides "Câble HP 2×1,5 mm²" and "CABLE HP 2x1,5 mm2" are
  the same words written by two people.
- `item.ts` — `matchItem`, `rememberAlias`, `rememberMatch`, `createItem`. This
  is "Remembered for next time": once a client wording is matched to a supplier
  article, the *item* knows both, so a different enquiry from a different client
  finds it.

**Phase 4 — the screens themselves**, at the routes they belong to, consuming
what is above.

## Why this is the right cut

The sentence screen 75 is built around — *"the system recognises it next time,
including on a different enquiry from a different client"* — is a claim about
where the memory is stored, not about how the page looks. Storing it on the
item rather than on the deal is the decision, and it is testable today:
`tests/integration/item.test.ts` proves the second enquiry lands on the item
without ever creating a deal.

Had this waited for phase 4, the natural place to put the memory would have been
the offer line, because that is what is on screen when you build it. That is the
mistake this cut avoids.

## The cost

Two of phase 1's eight screens have no route yet, so "phase 1 is done" has to be
stated carefully: the *records and search* half is done, and the two offer-time
screens are half done, with their logic in place and tested.

Phase 4 must not rebuild any of it. If the offer builder grows its own
designation rule, this document is the thing that was ignored.
