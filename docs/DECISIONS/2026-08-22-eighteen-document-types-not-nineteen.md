# Eighteen document types, not nineteen

**Screen 50. 2026-08-22.**

`docs/PLAN.md` §3.3 says "one document table, nineteen kinds", and screen 50
draws nineteen rows. The catalogue seeds eighteen.

## The duplicate

Rows 10 and 19 of the frame are the same piece of paper under two names:

| # | Document | Series |
|---|---|---|
| 10 | Supplier goods receipt | `BR-{YYYY}-{####}` |
| 19 | Goods receipt — bon de réception | `BR-{YYYY}-{####}` |

Same series, same family, same conversion target. Seeding both would put two
rows in a table whose primary key is the kind, and — worse — give the company
two names for one document, which is exactly the drift the screen's own banner
warns about ("a client that wants something different gets a template, never a
new structure").

The frame was mid-edit when it was read: its footer says *"Showing 1–10 of 10"*
over nineteen rendered rows, and the tab badge says `Types 10` while the
subtitle says nineteen. One kind is seeded, `goods_receipt`, with the French
name *Bon de réception*.

## What the catalogue holds, and what it does not

`document_type` holds what a kind **is**: its family, its legal weight, whether
it takes a number of ours, what it can become, which languages it is ever
written in, and whether this company uses it.

It does **not** hold the numbering pattern or the counter. `numbering_series`
owns those, because the counter has to be locked and incremented inside the
issuing transaction, and a second copy of the pattern is a second answer to the
question "what is the next invoice number". Screen 50 shows the pattern, and the
suggested one where none is configured, and links to day one to set it.

## Two things the catalogue changes about issuing

1. **A kind that is switched off cannot be issued.** `NotRenderable("typeIsOff")`.
2. **A client purchase order never consumes one of our numbers.** Its numbering
   is `clientReference`: the number is the client's own, and generating one of
   ours would invent a reference the client has never seen and cannot match
   against their order. The engine skips `reserveNumber` for that kind and still
   marks the document issued.

## An empty catalogue is not a refusal

`issuingRules()` returns null for a kind nobody has written down, and the engine
treats null as "carry on". A company that has not opened screen 50 must still be
able to issue an invoice. Treating "nobody filled in this screen" as a blocker
would be the system inventing a requirement of its own — the same mistake the
compliance profile exists to prevent, in a different costume.

## Two dangling conversions, named rather than hidden

`service_report → reception_report` is fine, but the mockup also has
`goods_receipt → supplier_invoice` and `reception_report → retention_release`,
and neither destination is a type. They are recorded as known gaps in
`tests/integration/document-types.test.ts` rather than quietly dropped, so that
adding the buy-side invoice or the retention release later has a test already
waiting for it.
