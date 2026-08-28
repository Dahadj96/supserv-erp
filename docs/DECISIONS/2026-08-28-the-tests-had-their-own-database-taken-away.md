# The integration tests get their own database

Date: 2026-08-28
Status: in force

## How this was found

Screen 66 walks the working file store and reports bytes that no database row
claims. The first time it ran against the real machine it reported **131
orphaned files, 88 kB** — out of 133 files total. Two claimed, 131 not.

Pulling that thread: every one of them was written by a dossier integration
test, into `.data/files`, which is where the real email attachments live.

Which meant the tests were running against the real file store. Which meant
checking what else they were running against.

## What was true

`tests/setup-env.ts` said so out loud, and had said so since the suite was
written:

> Integration tests read DATABASE_URL from the same .env the app uses.

So `pnpm vitest run` inserted into, updated and deleted from **`supserv`** — the
database holding real mail from `contact@supserv-dz.com`, its classifications,
and its read state.

The deletes are all disciplined: every one is scoped to a fixture id, a
`TEST-` prefixed code, or a fixture actor id. Nothing was ever going to
`DELETE FROM party`. But three tests reached rows that are not fixtures:

- **`engine.test.ts`** ran `saveIdentity()` against the real `company_identity`
  row — overwriting the legal name, RC, NIF, NIS and AI that go on every
  invoice — and recorded only `hadIdentity: boolean`. When identity existed,
  teardown skipped the delete and put nothing back. The fakes would have stayed.
- **`setup.test.ts`** set `ai` to null to prove the day-one gate notices a
  missing article d'imposition, with the same boolean and the same result.
- Both deleted and rebuilt the `invoice` numbering series. `engine.test.ts`
  snapshots and restores it byte for byte, which is correct and was already
  commented as such.

## Why nothing was actually lost

Day one has never been done. `company_identity`, `numbering_series`,
`bank_account` and `vat_rate` were all **empty**, every time. The boolean was
always false, so teardown always took the delete branch, and there was nothing
to restore because there was nothing there.

The bug was armed and pointed at exactly one event: **the first `pnpm test`
after somebody finishes the setup wizard.**

The audit log tells the story. Of 323 entries in the application database, 276
had an `actor_id` beginning `test-`. The screen built this morning to show who
changed what was 85% test fixtures.

## The decision

**The integration suite runs against `<database>_test` and cannot be talked out
of it.**

`tests/setup-env.ts` derives the test URL from `DATABASE_URL` by appending
`_test` to the database name, and throws if that swap did not happen. There is
nothing to configure and no flag to forget — which is the point. A convention
that depends on remembering is the convention that was already in place.

It also redirects `STORAGE_LOCAL_PATH` to `.data/test-files`, so bytes stop
landing next to real attachments.

`pnpm test` now runs `scripts/test-db.mjs` first, so the test schema can never
drift into "tests pass, production has a column they have never seen".

The database is created once, by hand, with its two extensions — `pg_trgm` and
`unaccent` are not optional, because search is the thing under test and a
database without them fails in a way that looks like a broken query:

    docker exec supserv-db psql -U supserv -d postgres \
      -c "CREATE DATABASE supserv_test OWNER supserv;"
    docker exec supserv-db psql -U supserv -d supserv_test \
      -c "CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;"

## And the snapshots were fixed anyway

`engine.test.ts` and `setup.test.ts` now keep the whole `company_identity` row
and put it back, the way `reprint.test.ts` already did. `engine.test.ts` also
restores the `invoice.stampDutyThreshold` confirmation instead of nulling it.

Those fixes cannot reach anything real any more. They are the actual rule
regardless: **a test may borrow state, and then it has to give it back.** A
boolean cannot give anything back.

## What is left behind, and not cleaned up automatically

`scripts/clean-test-litter.mjs` reports, and removes only with `--yes`:

- 276 audit rows whose `actor_id` begins `test-`
- 131 orphaned files in `.data/files`

**Deleting audit rows is not normal here** — `src/domain/control/audit.ts`
argues at length that an entry outlives the record it describes. The exception
is narrow and checkable: `test-` is a fixture constant and can never be an Entra
user id. If that ever stops being true, the script should be deleted rather than
loosened.

It is not run automatically, and this session did not run it. Removing 276 rows
from an append-only log is a deliberate act, not a tidy-up somebody does on
your behalf.
