# An erratum is not a re-import

**30 August 2026 — screen 42, BPU import and pricing.**

## The situation

A bordereau des prix arrives as a spreadsheet with forty-two lines. It is
imported, and over the next three weeks thirty-one of those lines are priced —
some from supplier proformas, some from a price somebody was given over a
counter in Adrar, some from what we last paid for the same article.

A fortnight before the deadline the buyer issues an **erratum**. Line 12's
quantity moves from 1 000 to 1 400. Line 18 is reworded. Line 27 changes unit.
Line 33 is removed.

There are two obvious things to do and both are wrong.

**Re-import the file.** Correct, and it destroys thirty-one gathered prices.
The lines that did not change lose their prices along with the lines that did.

**Ignore it.** The bid is submitted against quantities the buyer has withdrawn.

## The decision

The incoming file is **diffed** against the lines held, and the diff is what a
person reviews. Nothing moves until somebody applies it.

### The line number is the identity

Not the designation. An erratum that rewords line 18 is still line 18, and
matching on words would report a deletion and an addition and lose the price
attached to it. The client numbers their own schedule and every conversation
about the tender uses that number.

### A quantity change keeps its price; a designation change does not

The unit price of a metre of pipe does not depend on how many metres the client
wants, and making somebody re-quote forty lines because the buyer moved a number
is how a deadline gets missed.

"Vanne papillon DN80" becoming "Vanne papillon DN100" is a different article at
a different price, and the words are the only thing that says so. The system
cannot tell a clarification from a substitution, and guessing in the direction
that keeps the old price is the guess that puts a wrong number on a submitted
bid. A unit change is the same case: a price per metre is not a price per unit.

### A price that no longer applies is stamped stale, not deleted

`price_quote.valid_until` already carries the meaning — "after this date the
price is stale and screens say so. Never auto-deleted: an old price is evidence
of what something used to cost." An erratum stamps it on every price held for a
line it reworded. What a supplier said a DN80 valve cost in August stays on
file; the line simply stops counting it as a cost.

Detaching the price from the line instead — `deal_line_id` to null, the
"becomes a catalogue price" path the schema describes for a deleted enquiry —
was tried and does not work. `price_quote_has_a_subject` refuses a row with
neither an item nor a line, and a bordereau line nobody has matched to the
catalogue has no item. It would succeed on the matched lines and throw on the
rest.

### An issued offer is not amended, and the erratum says so

LAW 5. If a quotation has already gone out against the previous bordereau, the
client is holding a piece of paper with the old quantities on it and no erratum
changes that. Applying one over an issued offer is refused until somebody ticks
a box saying they know, and the acknowledgement goes in the audit row with the
list of offer numbers. A price on a **draft** offer for a line that lost its
price is cleared, because the screen reads "our price" from there and would
otherwise be showing a figure for an article the client no longer asked for.

## What this cost elsewhere

Two things had to be true that were not.

`document_line.source_line_id` points at another **document** line — it is how a
bon de livraison line says which order line it delivers. It does not link an
offer line to the enquiry line it answers, and nothing else did either: the
offer builder wrote its lines in order and kept no pointer back. So
`document_line.deal_line_id` was added, and `buildOffer` now sets it. Position
cannot stand in for it, because the client's numbering has gaps in it as soon as
an erratum removes a line.

`price_quote` had no filter for staleness on the read side. It does now: a
quote with a `valid_until` in the past is not a cost, which was already true of
a supplier's own expiry date and had simply never been enforced.

## What was NOT decided

Nothing here sets a selling price. "Our price" on screen 42 is read from the
draft offer, and screen 12 is where it is set, under `offers.margin.view`. A
second place to type a price is a second place for the two to disagree.
