# What a document becomes

**Date:** 5 September 2026
**Status:** built — the catalogue can be corrected, and says which conversions are real

## What was wrong

Two problems in the same column of screen 50.

**The catalogue could never be corrected.** `ensureTypesExist()` inserted with
`onConflictDoNothing()`. Every field on `document_type` — the family, the legal
value, how it is numbered, what it becomes, which languages it prints in — is
owned by `SEED_TYPES` in code and could only ever be written once. A row
recorded in August kept August's answer for ever, while the catalogue in the
repository went on being edited, and screen 50 printed the old one beside a
"Write down the types" button that did nothing. Pressing it said *Everything
was already written down*, which was true about the rows and false about their
contents.

**The column claimed conversions the engine will not do, and hid two it will.**
`convertsTo` and `CONVERSIONS` in `src/documents/conversion.ts` are two answers
to one question and they had drifted:

| kind | catalogue said | engine does |
|---|---|---|
| `quotation` | proforma, invoice | proforma, **client_order**, invoice |
| `proforma` | invoice, advance_invoice | **client_order**, invoice |
| `client_order` | delivery_note, invoice | invoice |
| `invoice` | credit_note | — |
| `purchase_order` | goods_receipt | — |

`client_order` — recording the client's own order, the one thing that moves an
enquiry to won — was done by the engine and absent from the catalogue. And the
column rendered as a plain comma-separated list, which reads as a list of
buttons.

## Decisions

**The code owns what a kind IS; the person owns whether it is on.**
`ensureTypesExist` upserts family, legal value, numbering, `converts_to`,
languages and position — and deliberately does not touch `active`, which
`setActive` writes from screen 50. A kind somebody switched off does not come
back on because the catalogue was rewritten.

**The count means new, not touched.** With an upsert every row is written every
time, so the screen would have said "22 types written down" on every press for
ever. It reads the kinds that existed first and reports how many are actually
new, and the sentence now says the rest were refreshed.

**The column may say more than the engine does, never less.** A bon de commande
client does become a bon de livraison — somebody records that delivery on
screen 49 rather than pressing anything. That is worth printing: it is the
paper flow of Algerian commerce, and this table is where somebody looks it up.
So the catalogue keeps the paper flow, and a test holds `CONVERSIONS` as a
subset of `convertsTo`: a conversion the engine offers and the catalogue omits
is a capability nobody reading the settings screen knows exists.

**And the screen says which is which.** The conversions screen 48 will actually
do are in ink; the rest are grey with a star, and a line under the table says
they are done by hand on the screen they belong to. Telling somebody a button
exists is worse than telling them it does not.

## What was rejected

**Deriving `CONVERSIONS` from the catalogue.** That would turn a description of
the paper flow into a set of buttons, and half of them would open a converter
for a conversion nothing implements.

**Dropping `converts_to` as a second source of truth.** It is not a second
answer to the same question — it answers "what does this paper become", where
`CONVERSIONS` answers "what will this system make for you". Both are worth
having; only one of them is a button.

**Upserting `active` too, for a clean re-seed.** A person switched that off.
Nothing in a catalogue rewrite knows why.
