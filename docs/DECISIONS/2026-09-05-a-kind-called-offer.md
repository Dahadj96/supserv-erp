# A kind called offer

**Date:** 5 September 2026
**Status:** built — the source is held against the catalogue

## What was wrong

This ERP has no document kind called `offer`. The catalogue calls a devis
`quotation`, and has since the day it was written. The word was in the source
five times anyway:

1. **Day one's numbering screen** offered *Offre* in the dropdown, so a Gérant
   could create a numbering series nothing would ever use. (Closed earlier
   today — ACCEPTANCE 26.)
2. **`ISSUE_PERMISSION`** in `src/auth/can.ts` had `offer: "offers.issue"`, in
   a map whose comment says it is "deliberately exhaustive rather than
   defaulted" — a line nobody can reach, in the file a reviewer reads to find
   out who may issue what.
3. **Screen 28's offers chart** called `issuedByMonth("offer")`.
4. **`SOLD_KINDS`** in the price history listed it among six kinds a unit price
   of ours can be found on.
5. **A merge test fixture** created a document of that kind.

None of them threw. `WHERE kind = 'offer'` matches no rows and returns an empty
result, a permission nobody reaches looks like a decision somebody made, and a
sixth name in a list of six reads as one of the six.

The third is the one that mattered. Screen 28 has said **"Aucune offre émise"**
since it was built — to a company that issues them every week. A report that is
confidently wrong is worse than a report that is missing, because somebody acts
on it.

## Decisions

**An offer is a devis OR a proforma, and both are counted.** The company sends
whichever the client asked for — a proforma for somebody who has to pay against
it, a devis for a tender. `domain/deal/deal.ts` had already reached the same
answer for the pipeline (`OFFER_KINDS = ["quotation", "proforma"]`); the report
now agrees with it rather than inventing a third answer.

A devis converted to a proforma for the same job counts twice. That is accepted
and said out loud in the code: two offers did leave the building. Picking one of
the two kinds would show nothing at all for half the company's work, which is
the failure this is fixing.

**`issuedByMonth` takes kinds, plural.** The single-kind signature is what made
the bug expressible.

**The source is read and held against the catalogue.** A new test scans every
`.ts` and `.tsx` under `src` for arrays of nothing but lowercase quoted words,
takes any with two or more real document kinds in it as a list of kinds, and
fails on a member the catalogue does not have. The shape is narrow on purpose:
that is what a list of kinds looks like and almost nothing else is.

`CHAIN` is the one allowed exception, because `payment` is a step in screen
48's chain and not a document this system issues. It is named in the test
rather than excluded by a rule, so a second exception is a decision somebody
makes in writing.

**`ISSUE_PERMISSION` is checked in both directions.** It calls itself
exhaustive; now it has to be. A kind with no entry fails, and an entry for a
kind that does not exist fails.

## What was rejected

**A TypeScript union for the kind.** `type Kind = "quotation" | …` would have
caught all five at compile time, and it is the right answer for a codebase that
owns its data. This one reads `document.kind` out of a database where a row
written by an earlier version can hold anything, so the type would be a claim
the compiler cannot keep — and every read would need a cast that quietly makes
the claim anyway. The catalogue is the authority and the scan checks against
it.

**Counting `quotation` only, to avoid the double count.** Half this company's
offers go out as proformas.
