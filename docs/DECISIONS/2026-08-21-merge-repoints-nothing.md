# A merge repoints nothing

**Date:** 2026-08-21
**Screens:** 84 (merge duplicates), 82 (search), 83 (deleted and restore)

## The decision

When two companies merge, **no row is moved from the retired record to the kept
one.** The retired row stays exactly where it is, `superseded_by` points at the
survivor, and every read follows the chain.

## Why not the obvious way

The obvious implementation is `update document set party_id = kept where
party_id = retired`. It is one line and it is wrong.

**LAW 5 — an issued document is immutable.** The counterparty is not metadata
attached to an invoice; it is part of what was issued. An invoice that said
CL-0031 on the day it was sent to a client must still say CL-0031 in three
years, or the copy in the client's file and the copy in this system disagree,
and the one in the client's file is the one that counts.

Repointing also has no safe failure mode. If a merge is wrong and has already
rewritten two hundred foreign keys, undoing it means knowing which two hundred.
With `superseded_by`, undoing a merge is clearing one column.

## What this makes true for free

- **"Old links still work — they land on CL-0007."** True by construction, not
  by a migration that has to be got right exactly once.
- **"Old reference searchable forever."** The merge copies the retired code,
  legal name and trade name into the kept record's aliases. Searching CL-0031
  finds the survivor and says it matched an alias, so the answer never looks
  like a bug.
- **"Reversible, 30 days."** `merge_log.reversible_until`, and the reversal is
  one `update`.

## The cost, stated honestly

Every query that reads a party must resolve the chain — `where superseded_by is
null` for lists and search, and a follow-the-pointer read for a direct link. If
a future query forgets, it will show a retired company as though it were live.

That is a real ongoing tax. It is smaller than the alternative, which is a
system that quietly rewrites issued documents.

The counts shown on screen 84 ("Deals 9 + 2 = 11") are therefore **effective**
counts computed across the chain, not evidence that anything moved.

## Schema the screen forced

Screen 84 detects duplicates by email domain and by phone, and shows both
field-by-field. Neither column existed — not in the schema and not in
`docs/PLAN.md` §3.1. Added `party.email`, `party.phone`, `person.email`.

`duplicate_dismissal` is also new. Screen 84 says "'Not a duplicate' is
remembered so the same pair is never suggested again", and PLAN §3.6 had no
table for it. Without it the system nags forever and people learn to ignore it.
