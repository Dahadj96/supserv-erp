# Docker stays. Windows logs itself in.

**Raised** 26 August 2026, once the scheduled task worked and the last gap left
was the database.
**Decided** 27 August 2026 by the Gérant: *"keep them for docker, i will setup
windows to login when start"*.

## The problem this closes

Docker Desktop on Windows runs inside a user session. There is no supported way
to run it as a service. So after a power cut the machine boots, cloudflared
starts, the ERP starts — and the ERP has no database, because nobody logged in.

Three ways out were on the table: automatic login, native PostgreSQL as a
Windows service, or bringing the Ubuntu move forward. My recommendation was
native PostgreSQL. The decision went the other way, and the reasoning holds:

- It is the only option that changes nothing about how the system is built. No
  dump, no restore, no second Postgres to keep straight, no window in which the
  data lives in two places.
- The Ubuntu migration is still the destination. Anything done to Windows now is
  temporary by construction, and a temporary fix should be the cheap one.
- The office is locked. The threat this trades away is physical.

## What it costs, stated plainly

**Automatic login means the password is stored on the machine.** Done properly
it is an LSA secret, encrypted rather than plaintext — but anyone with
Administrator on the box, or with the disk in their hand, can recover it.

So: **whoever has physical access to SUPSERVPC01 has the account.** Not the
desktop, which a lock screen would cover — the account, and everything it can
reach: the mailbox, the ERP as the Gérant, the tunnel credentials.

Two things follow, and they are conditions of this decision rather than
suggestions:

1. **The screen locks immediately after the automatic login.** Windows signs in
   so Docker starts, then locks. The desktop is never left open. This is one
   scheduled task and it is in RUNBOOK §3.
2. **The plaintext method is not used.** `netplwiz`, or Sysinternals Autologon —
   both store an LSA secret. Writing `DefaultPassword` into
   `HKLM\...\Winlogon` puts the password in the registry in clear text, readable
   by any process on the machine. That is a different decision and it was not
   this one.

## What this does not fix

Docker Desktop still takes one to three minutes to come up after a login, and
Postgres a little longer. `run-erp.ps1` waits for it — the wait was raised from
five minutes to ten on the same day as this decision, because the five-minute
figure was a guess and a cold boot has never actually been timed.

If the wait runs out, the ERP serves anyway and says so in `.data\server.log`,
so the failure is legible instead of silent. That is the whole design: the
machine is allowed to be slow, it is not allowed to be quiet about it.

## Revisit when

The new desk PC arrives, or the Ubuntu move is scheduled — whichever is first.
Both delete this decision rather than amend it.
