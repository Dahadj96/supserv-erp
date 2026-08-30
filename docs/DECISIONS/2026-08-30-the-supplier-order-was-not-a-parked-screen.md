# The supplier order was not a parked screen

**30 Aug 2026.** PLAN §7 parks ten screens "after the first release", and screen
68 was one of them, filed under "tenders module depth". It is not tenders and it
is not depth.

## What was actually missing

Screens 09 and 67 ask suppliers for prices. Screen 12 puts those prices on an
offer. Screen 13 lists the order once it is placed. Screen 17 invoices the
client.

Between the purchase order and the supplier's invoice there was nothing at all.
No record of what arrived, no comparison of what was billed against what was
agreed. The frame's own last panel says it plainly, and it is the reason this
came off the parked list:

> Without it the client delivery date is a guess and the margin is whatever the
> supplier decides to invoice.

Both halves of that are true of this company today. A deal is won on a margin
computed from a supplier's quotation; if the supplier invoices 42 000 DZD above
that quotation and nobody compares the two documents, the margin the offer was
priced on was fiction and nobody finds out until the year is closed.

## What it cost to build: one nullable column

No new tables. A purchase order is a `document` of kind `purchase_order`, a
goods receipt is one of kind `goods_receipt`, and the lines are joined by
`document_line.source_line_id` — the same column screen 49 already uses to add
three delivery notes against one order.

LAW 3 is usually quoted about PDFs. This is what it is actually worth: the
screen that looked like a module needed a schema of one line.

That line is `delivery_detail.counterparty_ref`, the other side's own reference
for the same movement of goods. On a goods receipt it is the supplier's BL
number; on our own delivery note it is the client's reception reference. Every
conversation about a missing crate happens in THAT number, because it is the one
on the paper in the driver's hand.

## The nineteenth document kind

`supplier_invoice` did not exist. `goods_receipt` has converted to it on paper
since the catalogue was written, and the type test carried it as a "known gap"
alongside `retention_release`. A known gap that stays known for months is a
decision nobody made.

It exists now, numbered `clientReference` — the number on it is theirs and we
never allocate one — and the gap list is down to one.

## Three verdicts, not two

The match reports `matches`, `explained` and `doesNotMatch`, and the middle one
is the whole design.

A partial delivery billed correctly — 60 ordered, 40 arrived, 40 invoiced — is
the single most common shape this screen will ever show. Painting it the same
red as a supplier who quietly repriced a line teaches people to click past the
row that matters. `explained` means the two sides differ and something else on
the screen already accounts for it.

Two figures are kept separate for the same reason. On the frame's own order the
totals differ by 35 200 while the amount held is 42 000: line 5 is billed 1 050
over on 40 units, and line 4 is billed for the 40 that arrived rather than the
60 ordered, which takes 6 800 back off. A screen that quoted the gap between two
totals as the amount in question would understate this one and would call a
partial delivery a discount.

## What the frame draws and this does not

"Paid on order 500 850 · Due on delivery 500 850", split out of the terms.

`party.payment_terms` is free text — "50% on order, 50% on delivery", "30 jours
fin de mois", "à la livraison". Pattern-matching a payment schedule out of that
would be right most of the time, and a wrong figure on the panel that decides
what SUPSERV pays a supplier is worse than no figure. The terms are shown in the
words somebody wrote; what has been paid is read from the bank.

## The frame's numbers do not add up, and that is recorded

Its match panel prints 140 ordered / 120 received / 120 invoiced, and its line
table three inches above says line 5 has not arrived — which makes 80 received.
Its ordered total reads 1 001 700; the five rows come to 960 400.

Mockup figures are typed, not computed. This is the screen whose entire purpose
is to catch numbers that disagree with each other, so it would be a poor joke to
seed it with some. The line table is taken as the truth, the totals are derived
from it, and the test says so in as many words.

What survives is the number the screen is about: 42 000, on line 5. A difference
is arithmetic on two figures that were typed together.
