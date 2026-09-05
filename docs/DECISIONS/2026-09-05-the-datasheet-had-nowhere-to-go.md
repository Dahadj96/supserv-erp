# The datasheet had nowhere to go

**Date:** 5 September 2026
**Status:** built — screen 77 attaches, screen 60 lists, `/api/files` serves

## What was wrong

`item_media` was read in three places — screen 77's table, screen 78's
"datasheet held" badge, and the technical file's `hasDatasheet` — and inserted
in none. There is no `addItemMedia` anywhere in `src/`; every row in the
repository came from a test fixture.

So the table on screen 77 was always empty, the badge on screen 78 said *no
datasheet* about every item in the catalogue for ever, and an Algerian tender
asking for a **fiche technique** had nowhere to keep the answer. The same
datasheet was chased from the supplier for the second tender that needed it,
which is the exact cost the screen was designed to remove.

Its `file_id uuid not null` pointed at a table that does not exist and will not:
`src/domain/files/index.ts` opens with "There is no `file` table, and there is
not going to be one."

Found by `pnpm audit:schema`.

## Decisions

**The row owns its bytes.** `item_media` is the fourth owner in the files view,
beside an email attachment, a read dossier and an import batch — exactly the
arrangement that module already describes. `storage_path`, `filename`,
`content_type`, `size_bytes` on the row; screen 60 lists them as a fourth
facet; `/api/files/item:<id>` serves them through the same permission and
content-type rules as everything else.

**Who may read it: everybody signed in, and that is a decision.** `NEEDS` now
takes `Permission | null` and `item` is null. The two read gates this ERP has
are `inbox.view` (raw correspondence) and `offers.margin.view` (cost), and
`src/auth/can.ts` argues at length why there are only two. A manufacturer's PDF
for a cable is neither — and the site foreman who has to fit the thing is
exactly who needs it. The map is still exhaustive by type, so a new file kind
will not compile until somebody decides, including deciding that everybody may.

**What the file IS and where it came from are asked, never guessed.** Not from
the filename, not from the content type. "This PDF is the manufacturer's
certificate" is a claim, and a claim needs somebody behind it — the same rule
that put a name and a date on a physical estimate and on a checked habilitation
earlier today.

**The stored path is built, never taken.** `items/<item code>/<timestamp>-<safe
name>`. A filename is the one string on an upload that an attacker chooses.
`safeJoin` in the local driver already stops `..` escaping the root; this stops
it being tried, and the timestamp stops two files with the same name from
overwriting one another.

**Ten megabytes.** A datasheet is a PDF. Beyond that it is a mistake, and the
screen says so rather than filling a disk on a mini PC in Adrar.

**`locked` dropped.** It said "a picture the client sent is locked to the deal
it arrived on" — which `deal_id` already says. LAW 1: two columns that must
agree are one that can be wrong.

**`price_quote.evidence_file_id` dropped.** Both callers wrote `null` into it;
nothing in this ERP can attach a file to a captured price. What a price has to
say for itself is `is_verbal` (said, not written), `captured_from` and
`captured_place` — all three written, read and shown.

## What was rejected

**A `file` table.** The module's first paragraph is the argument, and it has not
weakened: a fifth table duplicating the four owners is a table that can disagree
with them.

**A supplier picker on the form.** `party_id` stays on the row and the domain
function takes it, but the form asks "where it came from, in words" instead —
"ENAGEO, par e-mail du 12/06". A required company record for a PDF somebody was
sent is how a datasheet ends up not being filed at all.

**Guessing `media_kind` from the content type.** A PDF is a datasheet, a
certificate, a manual or a diagram, and only the person holding it knows which.
