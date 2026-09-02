# The client says yes: their order is a document made from the offer

**Date:** 2 September 2026
**Status:** decided, built, pinned by `tests/integration/a-to-z.test.ts`

## What was found

The first walk of one enquiry from the client on file to a paid facture —
driving the functions the screens call, in the order the screens are reached —
showed that the chain had no middle. An offer could be built, priced and
issued; a facture could be made from a proforma; a delivery note and a facture
could be made from "the order". Nothing could make the order. `client_order`
existed as a kind and as the one thing that moves an enquiry to "won", and no
screen and no function created one.

Three more things fell out of the same walk and are recorded here because they
were all the same mistake from different angles:

- an offer priced on screen 12 reached the PDF with "Total HT 0,00", because
  pricing a line and summing the document were two different files and only
  the builder did both;
- a client's order carries the client's number, and delivery, billing, the
  builder and screen 18 all read "has a number" as "is issued";
- screen 48 asked for the payment method and wrote it to the audit log only.

## What every sales system does here

Odoo, Dolibarr, Sage: quotation → **confirm** → sales order → delivery →
invoice. "Confirm" copies the accepted lines once, under the client's
reference, and everything downstream hangs off that copy rather than off an
offer that may be revised twice more. The order is the commitment document;
the offer is the proposal. This system already drew that line for proforma →
facture on screen 48 ("the proforma is never replaced") and simply had not
drawn it for the step before.

## Decision

1. `client_order` joins the conversion table: `quotation` and `proforma` may
   become one, and a `client_order` may become an `invoice`. The conversion is
   screen 48 with two extra fields — the client's reference and the order date
   — reached from the deal page by "Record their order" on an issued offer.
2. The client's reference IS the document's `number`. LAW 5's "null until
   issued" is about numbers we allocate; theirs exists before we do anything.
   The partial unique index `document_kind_number_once` enforces LAW 5 for our
   kinds and leaves theirs out.
3. **The state says whether a document is issued, never the number.**
   `status = 'issued'` in the domain, `issued` on the rendered document for
   the screens. A draft order nobody has recorded is not a win.
4. Recording the order is issuing it, through the same engine: compliance
   checks run, `lockedAt` is set, no number of ours is taken (`reservesNumber`
   is false for the kind). Two steps — Create draft, then Issue on screen 18 —
   rather than one "Confirm" button, because nothing here becomes a fact until
   a person has read it (LAW 2). A one-click confirm can come later as a
   shortcut over the same two calls.
5. `documents/totals.ts` is the one place that sums a draft outside the
   builder, and it runs wherever a price changes: offer build, margin, per-line
   price, BPU erratum. A document never reaches issue with prices on its lines
   and `{}` in its totals again.
6. Screen 48 takes a mode de règlement (the five words `payment.method`
   uses) and the facture inherits it; the free-text terms stay free text.

## What this does not decide

Whether an order should be confirmable in one click from the offer page. It
should, eventually; the two calls exist and a button that makes both is a
small change once somebody has watched a person do it the long way twice.
