# The délai, and what being late costs

**Date:** 5 September 2026
**Status:** decided and built

## What was found

The avenant built hours earlier could move a price and add one. It could not
move the **délai** — and an *avenant de prolongation de délai* is one of the
two commonest avenants a wilaya raises. It carries no bordereau at all: a new
date, a reason, two signatures.

Worse, nothing in the ERP knew what being late cost. `deal.late_penalty` held
the clause verbatim — *"1‰ par jour, plafonné à 10 %"* — since phase 4, and
nothing read it. A project three weeks past its délai looked exactly like one
delivered on time.

## Decisions

**An avenant with no line is still an avenant.** `amendment_detail` carries the
two things an avenant does that no line can say: `new_contractual_end` and
`reason`. `saveAmendment` refuses only when there is no price, no addition AND
no new date; an avenant that states nothing but a date writes no lines and
stores `{}` for its totals, the way a bon de livraison does — a computed block
of noughts reads as a bill for nothing.

**`project.contractual_end` is what the marché SAID, and never moves.**
`deadlineOf` composes it with the issued avenants and returns the délai in
force: the last avenant that named one wins, and everything that judges
lateness — `daysLeft`, the penalty, the badge on screen 16 — reads that and not
the signed date. This is the same shape as the bordereau: the signed document
is a fact, the composition is the answer.

**Pénalités de retard are computed and never applied.** `penaltyOf` is pure and
returns a figure the CLIENT may apply on the décompte général. Nothing is
withheld by us, deducted from a situation, or printed on a document we issue.
An ERP that quietly billed its own company a penalty would be inventing a debt
nobody had claimed.

**And nothing is computed until somebody has read the CCAP.** Three fields on
screen 16's terms panel — the rate per mille, the ceiling as a percentage, and
which amount they are taken on — and until all three are there the panel says
which one is missing rather than showing a reassuring zero. The client's own
wording sits beside them as the authority. This is the third time the same rule
has been applied: the retention base, the droit de timbre, and now this. No
legal claim without an authority and somebody who confirmed it.

**The base is a choice because the paper is ambiguous.** A marché is signed TTC
on the acte d'engagement and billed HT on the bordereau, so "du montant du
marché" is two different figures depending on which sheet is in your hand.
`penalty_base` takes the same two words the retention takes. On `incl` the TTC
is the marché's own HT with the BORDEREAU's VAT on it — `contractVatRatio` —
never a rate this system picked.

**The count runs to the réception provisoire, or to today.** While the work has
not been accepted the figure is still growing, and the panel says *en cours*
rather than presenting a number as settled. It stops at the ceiling and says it
stopped.

## What was rejected

**Writing the new délai onto the project when the avenant is issued.** It would
have been one column and no new table. It also would have destroyed the fact
that the marché was signed with a November date, which is exactly what an
argument about penalties turns on.

**Deducting the penalty from the next situation.** Tempting, since it is
arithmetic the ERP can do. It is also a decision the client makes on the
décompte général, and making it early would be this company docking its own
invoice for a claim nobody has made.

**Deriving the rate from `deal.late_penalty`.** The text says "1‰ par jour,
plafonné à 10 %" and a parser would be right most of the time. Most of the time
is not a standard for a figure somebody will be paid or not paid on.

## What this does not do yet

The **décompte général et définitif** — the paper that closes a marché:
everything certified, less everything paid, plus the retention released, less
the penalties the client applies. Every part of it now exists as a fact in this
system, which is why it is the next thing and not this thing.

**Révision des prix** still waits on an external text and always will until
somebody types the index values: the formula is public, the ISTP figures are
published monthly by the ONS, and a révision computed from indices this system
guessed would be a claim with no authority behind it.
