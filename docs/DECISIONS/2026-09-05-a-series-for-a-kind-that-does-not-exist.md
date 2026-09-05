# A series for a kind that does not exist

**Date:** 5 September 2026
**Status:** built — day one offers every kind that takes one of our numbers

## What was wrong

Screen 85's numbering step offered five document kinds, typed into the screen:

```ts
const SUGGESTED = ["invoice", "offer", "delivery_note", "proforma", "credit_note"];
```

Two things are wrong with that list, and the second is the expensive one.

**`offer` is not a kind this ERP has.** The catalogue calls a devis
`quotation`. So a Gérant could finish day one having created a numbering series
that nothing would ever look at, and discover it on the morning they issued
their first devis — which is the worst possible morning, because the screen
that refuses does not know why and can only say there is no series.

**The kinds a marché needs were not on the list at all.** `final_account` — the
décompte that closes a marché — and `retention_release` — the paper that asks
for the retenue de garantie back — could not be created from day one. Neither
could `situation`, `purchase_order`, `statement`, or any of the other kinds the
catalogue carries a pattern for. The company this ERP is being built for does
public works. The two documents it cannot finish a job without were the two the
wizard would not let it set up, and the standing instruction for a fortnight
was "create the DEC and RG series on screen 50" — a step somebody had to
remember, on a screen the wizard never mentions.

Nothing checked, either. `seriesInput.kind` was `z.string().min(2)`: any word.

## Decisions

**The kinds come from the catalogue, and the catalogue already knew.**
`SEED_TYPES` carries `pattern: string | null` for every kind, and it is null
exactly when `numbering` is `clientReference` — a bon de commande client, an
avenant, a supplier invoice: papers that arrive with somebody else's number on
them. So `SERIES_KINDS` is the kinds with a pattern, and that is the set the
select offers and the validator accepts. One list, derived, not two lists that
can disagree.

**Three refusals with their own words.** `kindUnknown` (not in the catalogue),
`kindIsTheirs` (this document carries the client's number), `kindTaken` (there
is already one). Reporting any of them as "something in the form was not
accepted" sends somebody to look at their pattern, which is not where the
problem is.

**One series per kind, said by the database.** Every reader joins on `kind` and
takes one row — screen 50's table, the allocator at issue, day one's "already
set up" list. Two rows for `invoice` is two shapes of invoice number in one
year, and the allocator would take whichever Postgres handed back first, so it
would not even be consistently wrong. `numbering_series_kind_uq`, migration
0050.

**The suggested pattern is shown beside each kind, and never filled in.**
`Décompte final — DEC/{YYYY}/{###}` in the dropdown. The shape is the Gérant's
decision and it is frozen once the first document carries it; a prefilled field
is a decision made by whoever wrote the seed.

**The table shows the label, not the kind.** `final_account` is a column name.
The person reading that table is the one who has to recognise the document.

## What this found

The **test database had thirty-five `final_account` series and twenty-three
`retention_release` ones**. Two tests create a series with
`.onConflictDoNothing()` — which, with no unique constraint to conflict on,
conflicts with nothing and inserts every run. Fifty-six duplicate rows, and any
of them could have been the one the allocator picked. The unique index makes
those two `onConflictDoNothing()` calls mean what they say.

The application database had no duplicates and twelve series — the twelve
somebody created by hand, without `final_account` or `retention_release` among
them, which is the hole this closes.

## What was rejected

**Creating the missing series automatically on day one.** The pattern is frozen
from the first document that carries it. A system that picks `DEC/{YYYY}/{###}`
because a seed file said so has made a decision that cannot be undone, on
behalf of somebody who was never asked.

**Deleting the duplicates in the migration.** `CLAUDE.md`: no hard DELETE, in
any migration, on any table. The duplicates were in a test database and were
cleared by hand; the index stops them coming back. A migration that quietly
deletes rows on a database it has never seen is worse than one that fails.

**Letting the kind stay a free string "in case a company has its own
document".** A kind this ERP does not have is a kind no screen can issue, no
template can render and no converter can follow. A series for one is a promise
nothing keeps.
