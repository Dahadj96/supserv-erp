# Delivering against the right paper

**Date:** 5 September 2026
**Status:** built — one list, asked by the button, the page and the domain

## What was wrong

Screen 18 showed *Record a delivery* on four kinds:

```ts
const DELIVERABLE = ["quotation", "proforma", "invoice", "situation"];
```

`client_order` is not there. That is the client's own bon de commande — or our
proforma back with *bon pour accord* written on it — and it is the document
this ERP treats as winning: `ORDER_KINDS` in `domain/deal/deal.ts` is exactly
`["client_order"]`, and `src/documents/conversion.ts` says, in the comment
above the conversion table, that recording it is what every sales system does
at Confirm, so that "the deliveries and the factures hang off that rather than
off an offer that may have been revised twice since."

The deliveries could not hang off it. The button was not offered.

And the list was the only gate. `/deliveries/new?source=<id>` read whatever id
was in the query string, looked the document up, and rendered the form;
`startDelivery` checked that the source was ISSUED and never asked what it was.
So `?source=` pointed at a bon de livraison made a bon de livraison against a
bon de livraison — and the same for a credit note, a purchase order, a
supplier's invoice, anything with lines.

## Decisions

**One list, in the domain.** `DELIVERABLE_KINDS` in
`src/domain/delivery/lines.ts` — the pure half of the module, so the button can
import it without dragging the database into a page that only wants to know
whether to show a link. Three callers ask it: screen 18, `/deliveries/new`, and
`startDelivery`. The last of those is the one that matters, because it is the
only one an attacker or a mistyped URL cannot skip.

**`client_order` first.** It is the canonical case and it was the missing one.

**`quotation` and `proforma` stay, deliberately.** A supplier in Adrar is told
yes on the telephone and the lorry leaves the same afternoon. Requiring the
bon de commande to be recorded before anything can be delivered is how a system
gets worked around — the BL gets written in Word instead, and then nothing in
the ERP knows what went out. When the order HAS been recorded, deliver against
it: that is where the remaining quantities are counted.

**`delivery_note` is refused, and always will be.** A BL cannot deliver a BL.

**A sentence, not a 404.** `/deliveries/new` with a source it cannot deliver
against says so and offers the document — the person arrived from a link, and
"this page does not exist" is not what happened. `sourceNotDeliverable` joins
the `deliveries.error.*` map that already carries the other four refusals.

## What was rejected

**Removing `quotation` because a professional ERP would.** SAP and Odoo create
a delivery from a sales order and nothing else, and they are right for a
company with a sales department. This company has six people and a telephone.
The rule that matters — you cannot deliver against a draft — is already
enforced, and it is the one that stops goods leaving against something the
client has not seen.

**Passing the list into the page as a prop.** It is a domain rule, and a page
that receives it as a prop is a page that can be given a different one.
