# Columns nothing is joined to

**Date:** 5 September 2026
**Status:** audit built, ratchet at 54, first two closed

## Where this came from

`project.closed_at` was read in three places and written in none. Nothing
failed, no test went red, and the only symptom was that no marché could ever
leave WARRANTY. It was found by accident, while building the screen that asks
for the retenue de garantie back.

That is a whole class of defect this repository had no way to see. The two
audits it already had look one layer higher:

- `audit-actions` asks whether a server action checks who is calling.
- `audit-forms` asks whether a field a person filled in reaches the action.

Neither asks whether the column at the end of that chain is connected to
anything. `pnpm audit:schema` does.

## What it reads

Drizzle declares a table as `pgTable("project", { … })` and each column as
`propName: type("db_name")`. The script parses those, then reads the whole
application — `src/`, `scripts/`, `drizzle/`, and deliberately **not**
`tests/` — and asks two questions per column:

- **read**: does `.prop` appear anywhere? Loose on purpose. Six tables have a
  `note`, and this cannot tell them apart; a column wrongly called READ is a
  finding the audit misses, and a column wrongly called UNREAD is a false
  alarm. An audit that cries wolf gets switched off.
- **written**: does `prop:` appear as an object key? That is what an insert's
  `.values({ … })` and an update's `.set({ … })` look like.

Excluding `tests/` is the point, not an optimisation. A column whose only
writer is a fixture is a column no screen can set — and `closedAt` passes a
naive version of this audit precisely because a unit test hands
`projectState` a `{ closedAt: … }`.

## Decisions

**A ratchet, not a gate.** The first run found 56. Refusing the build on all
of them would have meant either deleting fifty-six columns in an afternoon or
writing fifty-six exemptions, and an exemption list written in one sitting is a
list of guesses. So the script fails when the number GROWS, fails when it is
lower than the line in the file (so the line is kept honest), and passes when
it matches — the same discipline as the query budgets, which carry the
measured number in a comment beside them. It is in `pnpm check` from today.

**The exemption list is only for columns somebody else owns.** Better Auth
writes and reads `session.token` through its own adapter and the application
never names it. That is the only kind of line the list takes. A column of ours
that nothing touches counts against the ceiling until it is wired up or
dropped.

**56 → 54: who gave the estimate, and when.** `project.physical_by` and
`physical_at` have been written since `setPhysicalProgress` was first called
and read by nothing. The schema's own comment said screen 16 printed them.

That is not cosmetic. The most useful number on the page is one subtraction —
work done less work billed — and a subtraction between a figure computed this
morning and a figure a chef de chantier gave in June is not a number anybody
should act on. It is also the ERP's own rule: an estimate is stored BECAUSE it
is a person's, and an estimate with no name on it has quietly become a fact the
system asserts. Screen 16 now says "Estimation de M. Belkacem, le 19/08/2026",
and says in orange when it is older than a billing cycle.

## What was rejected

**Failing on every finding immediately.** See above: it forces either mass
deletion or mass hand-waving, in one sitting, on a database whose columns were
each added for a reason somebody had.

**Parsing TypeScript properly instead of reading lines.** A real parse would
tell `note` on one table from `note` on another and remove the loose-read
compromise. It would also be a dependency, a build step and an afternoon, to
sharpen an audit whose whole job is to point at a list a person then reads.

**Deleting the columns it finds.** Tempting for the nine on `user_preference`,
which nothing anywhere mentions. But a column dropped is a migration and a
decision about a screen that has not been designed, and this audit's first job
is to make the list visible. The ratchet is what makes sure the list is dealt
with rather than admired.

---

## What the first day of use changed — 56 → 45 → 26

Three real fixes took it from 56 to 45. Then the list itself was wrong in four
ways, each found by reading it rather than by running it:

**Better Auth's four tables are not ours to audit.** `src/db/schema/auth.ts`
says so in its first line: the library writes those rows and expects those
field names. Auditing them column by column is auditing a library's private
fields through our own file. A whole-table exemption, not thirteen lines.

**A column with a database default is written by Postgres.** `payment
.recorded_at` is `defaultNow()` — read everywhere, named in no insert, and
reported as "read and never written". Only that half is waived: a defaulted
column nothing reads is still a column nothing reads.

**A shared name was being cleared five times over.** Six tables carry a
`deleted_by` and only `party` has ever written one. A plain `.deletedBy`
anywhere marked all six as read — so wiring up ONE would silently clear five
findings. An audit reporting success it has not earned is the exact failure
this file exists to catch.

The fix that works is attribution BY FILE: `.deletedBy` counts as a read of
`party.deleted_by` only where the file also names `party`. Demanding the
drizzle reference `party.deletedBy` instead was tried and rejected in the same
sitting — it took the count from 40 to 132, because most reads here are
`row.thing` off a `select()` with no field list. Ninety of those were columns
read perfectly well, and an audit that cries wolf gets switched off.

**"Who did it and when" is not the same finding as a dead column.** Thirty-three
`*_by` / `*_at` / `reason` / `note` columns are written beside an `audit_entry`
carrying the same actor and the same moment, which screen 61 shows. The column
is the cheap local copy, read one day by a panel that wants to say "confirmé par
Amine le 12/06" without joining the trail — which is exactly what screens 16 and
25 now do. Printed as its own list; not counted.

What is counted is the two classes that have each already cost this ERP a
feature: **a column nothing mentions at all**, and **a column something READS
that nothing can write**. `closed_at`, `is_verified` and `reversible_until` were
all the second kind.

26 today, and the biggest single group is `user_preference` — nine columns and
a whole table nothing has ever touched.
