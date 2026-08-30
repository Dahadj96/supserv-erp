# The backup restores itself every night

**30 Aug 2026.** Until today the ERP had never been backed up. `.env` had had a
`BACKUP_*` section since the first week, `docs/SERVER.md` §2 called it the
largest single risk in the installation, and the RUNBOOK repeated it in two
places. None of that is a backup.

## What was built

`scripts\server\backup.ps1`, run by a scheduled task as SYSTEM at the time in
`BACKUP_AT`, and `scripts\server\restore.ps1`, which is the half that makes the
first one mean something.

## The decision: verify by restoring, every single night

A `pg_dump` that exits 0 proves the command ran. It does not prove the file can
be read back, and every way of discovering that later is the expensive way —
the discovery happens on the one morning the answer matters.

So every night, unattended, the script:

1. dumps `supserv`,
2. creates a scratch database,
3. `pg_restore --exit-on-error` into it,
4. counts every row of every table on both sides with one exact query, and
5. fails the run — loudly, with a non-zero exit and a red screen 66 — unless the
   two sides agree exactly.

It takes nine seconds on today's database and would take a few minutes on a
database a hundred times the size, at 02:30, while nobody is waiting. It is the
cheapest verification this system will ever get.

`--exit-on-error` is not decoration. `pg_restore`'s default is to log a failure
and carry on, producing a half-restored database and an exit code of 0: exactly
the shape of a verification that lies.

The counts are exact, from `query_to_xml`, not `pg_stat_user_tables.n_live_tup`.
That column is an estimate maintained by autovacuum and is wrong immediately
after a restore — a nightly check built on it would either pass when it should
not or fail for no reason, and unattended, both are worse than no check.

## The decision: `.env` is not backed up

It holds `MS_CLIENT_SECRET` and the database password. A copy of it on a USB
drive in a drawer is a copy of the company's credentials in a drawer, and it is
the same rule that has kept that secret out of every chat log all week.

Restoring a machine therefore means writing a new `.env` from `.env.example`
plus the password manager. That is a feature. The alternative is a backup set
that is itself a breach if it is ever lost, and backup sets are exactly the
thing that gets lost.

## The decision: refuse a fake destination rather than invent one

`BACKUP_LOCAL_PATH` still says `/mnt/usb-backup`, from when this was going to
be a Linux VPS. On Windows the obvious thing is to create `C:\mnt\usb-backup`
and carry on. That is the worst available outcome: a backup that looks
configured, sits on the disk it is protecting, and is trusted for a year.

So a POSIX path on Windows is treated as absent, the script falls back to
`.data\backups` and prints a warning every night, screen 66 shows **Same disk**
in amber, and the RUNBOOK says which drive letter to set. Nobody gets to
believe this is off-site until it is.

## The decision: the ERP reads the receipt, and stores nothing

The script writes `last-backup.json` twice — beside the backups, and into
`.data\`. Screen 66 reads the second copy.

Law 1, in a place it would have been easy to break. There is no backup table
and no "last backup" column: the file is the fact, the age is arithmetic
against now, and a receipt that stops being written turns the card red by
itself rather than by anybody noticing. The second copy exists because the
first one lives on a drive that will sometimes be in somebody's bag, and a
storage screen that can only answer while nothing is wrong is not a monitor.

`assessBackup` is pure and every state it can return has a test, including the
two that matter most: an unverified backup taken minutes ago still reports
`failing`, and a receipt with an unreadable date reports `never` rather than a
backup of unknown age. The bias is one-directional on purpose — this may never
report a state better than the truth.

## What is still not done

The drive. Nothing here can plug one in.
