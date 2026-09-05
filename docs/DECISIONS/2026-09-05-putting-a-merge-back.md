# Putting a merge back

**Date:** 5 September 2026
**Status:** built — screen 82's banner, thirty days

## What was wrong

`merge_log` had eight columns and the application read none of them. The one
that mattered was `reversible_until`: a promise made in the schema, about the
one operation in this ERP that quietly rewrites a record other people rely on,
that nothing could keep.

A merge on the wrong pair — and screen 84 suggests pairs, so somebody will
eventually confirm one they should not have — took a company's payment terms,
its address, possibly its legal name, and left the other record retired behind a
`superseded_by` pointer. There was no way back. The first person to notice is
usually the client, on a facture with the wrong name.

Found by `pnpm audit:schema`, which reported the whole table as written and
never read.

## Why it is possible at all

Because nothing is repointed. `domain/merge.ts` says so at the top and it is
the decision that makes this feature cheap: a merge is

1. the kept row's fields, where the retired row won,
2. the aliases it added,
3. one contact possibly created from the losing email address,
4. a `superseded_by` pointer.

None of it moves a document. So an undo is four small statements — provided
somebody wrote down what (1) was BEFORE, which nobody had. That is what
`merge_log.reverses` now holds, and nothing else: the kept row's previous
values for the fields the merge changed, the aliases this merge added, and the
id of the contact it made.

## Decisions

**Thirty days, and the window is now real.** Long enough for the person who
notices — often the client — to say so. Short enough that "reversible" is not a
promise about a company that has traded under the merged record for a year.

**The log row stays, marked reversed.** `reversed_at` and `reversed_by` rather
than a delete. The merge happened; a record of it disappearing would be the
second wrong thing done to the same pair of companies.

**Only the most recent, and only on the kept record.** Two merges deep, undoing
the older one first would restore fields the newer one has since changed —
refused as `notLast`. The banner lives on the KEPT company because that is the
record somebody is looking at when they notice the name is wrong.

**The contact is retired, not deleted.** Somebody may have written to
M. Belkacem in the meantime, and a note whose person vanished is worse than a
contact card too many.

**Aliases: only the ones this merge wrote.** Matched by value AND by
`source = 'merge'`, so an alias somebody typed by hand afterwards is theirs and
stays.

**`merge.execute`, the permission that made it.** Undoing is the same act of
judgement about the same two companies. A window only the Gérant can use is a
window that stays shut while he is in Adrar.

## What was rejected

**Deleting the retired row instead of clearing `superseded_by`.** It was never
deleted; it was retired. Deleting on the way back would be a different
operation from the one being undone.

**Recording the whole kept row in `reverses`.** Only the fields the merge
changed. A full snapshot would silently roll back edits somebody made in the
thirty days since — which is exactly the class of bug this feature exists to
undo.

**`movedCounts`.** Dropped. It was written as `{}` on every merge and read by
nothing: a leftover from the design where documents WERE repointed, which this
file rejected in its first paragraph.

## A note on the bug this found in itself

The first version asked "is there a newer merge on this record?" with
`merged_at > <the row's own merged_at>` and refused every undo as `notLast`.
Postgres keeps microseconds on a timestamp; a JavaScript `Date` keeps
milliseconds. Read back and compared to its own stored value, a row is newer
than itself. It now says `id <> this one` and means it.
