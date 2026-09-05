# The retenue de garantie was being chased as an unpaid invoice

**Date:** 5 September 2026
**Status:** found and fixed

## What was found

Screens 19 and 20 read what a client owes from `document.totals->>'totalIncl'`.
On an ordinary invoice that is right: the TTC is what was asked for.

On a **situation de travaux** it is not. A situation bills the work in full and
the client keeps back the retenue de garantie — 5 % under the CCAP, for a year
after the réception — and any advance already invoiced. The figure at the foot
of the wilaya's own form is the **net à payer**, and that is the sum they
transfer.

So a situation paid to the centime showed a balance equal to the retention. It
aged into the over-90 column. `isOverdue` was true. It could be picked as *the
single most neglected invoice in the company* on screen 20's red banner. And
the relance machinery would have drafted a letter chasing a wilaya for money
their own contract says they may hold — which is the sort of letter that costs
a company its next marché.

Nothing had noticed because the first situation only reached the payment
screens on 4 September, and nothing was paid on the test data.

## Decisions

**`Owing.owedNow` — what this paper asks the client to pay.** Optional, and
absent on every document whose totals carry no `dueNow`, which is every
ordinary invoice; `balanceOf` and `paidStateOf` prefer it when it is there.
Screens 19 and 20 needed one line each and nothing else changed, because on an
invoice `dueNow` IS the TTC.

**`totalIncl` keeps its name and its meaning.** It is the value of the work,
VAT and stamp duty included, and several places want exactly that. The bug was
not the field; it was one figure being asked to answer two questions.

**And the retenue comes back on its own paper.** It is not owed by a client who
is holding it lawfully — it becomes owed the day a `retention_release` is
issued, after the réception définitive. Until that kind exists, the money is
tracked on screen 16, where the project says what is held and when it is due
back, and it is deliberately not on the ageing report.

## What was rejected

**Leaving the receivable at the TTC and teaching the relance policy to skip
situations.** The relance would have been silenced and every other figure would
still have been wrong: the ageing total, the over-90 banner, the "balance left"
column, and the cap `recordPayment` allows an allocation up to.

**Renaming `totalIncl` to `owed` throughout.** Twenty-five call sites and four
test files for a rename that would have made a second field mean the first.
