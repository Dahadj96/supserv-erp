# The last thirteen

**Date:** 5 September 2026
**Status:** built — `pnpm audit:schema` is a gate, ceiling nought

## What was wrong

Thirteen columns were left in the schema that no code wrote, no code read, or
both. Nine of them were one table.

The audit was written this morning at 56 findings and came down the day in six
commits, each one a real hole: who gave a physical estimate and when, a man's
certifications, the undo a merge promised, nine dead preference columns, and a
datasheet with nowhere to go. What remained after those was the residue — the
columns that were not hiding a missing feature, only a decision nobody had
written down.

They are dropped, together, and the ceiling goes to nought.

## Decisions

**`saved_view` — the table goes, the feature stays.** Screen 79's saved views
are real: `SavedViews` renders them, `DataTable` takes them, and the deals list
defines two — *Closing this week*, *Nothing sent yet* — in code, with
translated names, because they ship with the application. What no screen offers
is **saving** one. So the nine columns described the feature in a shape it does
not have. They come back the day a list has a "save this question" control,
with the code that writes it. A note for that day, since it is easy to get
wrong: a view a person types keeps the language they typed it in and is never
auto-translated. That is why the seeded two carry message keys and a saved one
would carry a name.

**`numbering_series.reserve_on` — LAW 5 is not a per-series setting.** It held
`'issue'` on every row and was read by nothing. A number is allocated at ISSUE,
full stop; `document_type.numbering` already says which kinds take one of ours
(`reservedOnIssue`) and which carry the counterparty's. A column offering a
second answer to a question the catalogue has already answered is a column that
can disagree with it.

**`import_batch.source_kind` — the other value needs a permission nobody has
asked for.** `upload | onedrive`, `'upload'` on every row. OneDrive discovery
needs Graph `Files.Read`; the app registration does not have it and nothing in
`docs/` proposes asking. Every import in this ERP is a file somebody chose.

**`intake_attachment.sha256` — the code that would fill it is not built.** The
fetcher that pulls an attachment out of Outlook does not exist yet.
`storageFor().put()` already returns the digest, so this column is one line on
the day that fetcher lands — and it lands with the code that fills it, which is
the whole rule.

**`payment.bank_account_id` — there is one account.** `/setup/bank` holds the
company's RIB and screen 48 records a payment against a **client**, not against
one of ours. It comes back the day there are two accounts to reconcile
separately.

**`party.country` — `'DZ'`, and no address is ever assembled from parts.** One
free-text address, and a wilaya beside it because that is the axis the screens
actually use: who is near In Salah, which DRE issued the marché. A foreign
supplier's country goes in the address like everything else.

**`tender_piece.provided_at` — a piece is provided when it HAS a file.** One
fact, computed, LAW 1. `added_at` already says when the row appeared.

**`delivery_detail.departs_at` — nobody signed for the hour.** The BL carries a
date, its own `issued_on`. What time a lorry left Adrar is not a fact on a
document, and it was mentioned nowhere.

**`delivery_detail.site_contact_id` — the man on site is whoever is standing
there.** `site_contact_name` beside it takes him in words. Requiring him to be
an address-book record first is exactly how that field ends up blank, and
`received_by` is what he actually wrote when he took the delivery.

**`merge_log.field_choices` went the other way — wired up, not dropped.** It
records which fields a merge took from the losing record, which is precisely
what somebody looking at the undo banner wants to know: "took the NIF and the
address". `reversibleMerge` now returns them and the banner on screen 12 names
them, or says the merge took nothing but the aliases.

## What was rejected

**Keeping them "for later" with a comment.** That is what the comment says now
— but the column is gone, and the difference matters: a column that exists is a
column a screen can start writing to without anyone deciding, and a schema
where half the columns are aspirational is one where nobody can tell which half
is real.

**Dropping `saved_view` and the seeded views with it.** The two views on the
deals list are used. The table was never how they worked.

**Lowering the ceiling without dropping anything — marking them `ALLOWED`.** The
allow-list is empty and stays empty. Four framework tables are excluded because
Better Auth writes and reads them; everything else in this schema is ours to
answer for.

## What this changes about the build

`CEILING = 0`, so `pnpm audit:schema` is a gate rather than a ratchet: **a
column added and not used fails the build the day it is added.** The dated log
in the script's header stays, because the number going back up is the thing
worth noticing, and the log is what makes it legible.

The second list the audit prints — *recorded on the row and shown on no screen*
— is deliberately not part of the gate. Thirty-four provenance columns
(`decided_by`, `confirmed_at`, `delete_reason`) are written, never displayed,
and that is correct: they are what makes an answer defensible six months later,
not what a screen shows today.
