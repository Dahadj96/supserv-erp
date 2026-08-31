# RUNBOOK — the three things left, and how the mini PC becomes a server

Written 23 Aug 2026, the day `erp.supserv-dz.com` went live.
**Re-checked 28 Aug 2026. Read this box first.**

> ## WHERE THINGS STAND
>
> The site is **up**. `cloudflared` runs as a Windows service with its
> `--config` recorded in the registry — that missing flag was why the tunnel
> died at every reboot and answered **530** / error 1033 on 27 Aug. Fixed by
> `scripts\server\install-services.ps1`, and confirmed by a real reboot.
>
> Cloudflare Access guards the hostname, and since 28 Aug it authenticates
> against **Microsoft Entra ID** — the same directory as the mailboxes.

| § | What | State |
|---|---|---|
| 1 | **Cloudflare Access** — application, policy, Entra as identity provider | **done** 28 Aug |
| 2 | **Entra redirect URI** — so sign-in works on the new address | **done** |
| 3 | **Survive a reboot** — cloudflared installed; **the ERP is NOT a service** | **NOT done** — see the box below |

> ## THE ERP IS NOT SET TO COME BACK  — found 30 Aug 2026
>
> `Get-ScheduledTask` returns **nothing** for `SUPSERV ERP`. The task was never
> registered on this machine. What has been running on port 3000 was started by
> hand, and it was still serving a build from two days earlier — `/dashboard`,
> `/reports` and every route added since returned **404**, with the sidebar
> linking straight at them.
>
> `cloudflared` *is* a real service, so after a reboot the tunnel comes back and
> points at nothing. That answers with a Cloudflare error page rather than
> silence, which is the version that looks like the internet's fault.
>
> **Measured, 30 Aug, against the process actually on port 3000 —
> `pnpm smoke` says 41 of 85 routes are broken.** Seventeen answer **404**:
> they are screens built after that build was made, and the sidebar links at
> them. Twenty-four answer **500**: those routes exist in that build, but the
> database has moved forward under it — migrations 0033–0035 are applied — and
> old code querying new tables throws. It gets worse, not better, the longer it
> runs. Everything below is one command away from correct; the build on disk
> passes all 85.
>
> The process cannot be stopped from an ordinary shell — it was started from an
> elevated one, and `Stop-Process` answers `Access is denied`. It has to be you.
>
> **One command fixes all of it**, from an Administrator PowerShell:
>
> ```powershell
> cd C:\SUPSERV-ERP
> powershell -ExecutionPolicy Bypass -File scripts\server\install-services.ps1
> ```
>
> It registers `SUPSERV ERP`, registers `SUPSERV backup`, and runs the first
> backup while you watch. Afterwards `scripts\server\mode.ps1 status` names both
> tasks and says NOT REGISTERED in red if either is missing — it used to print a
> blank line, which is how this went unnoticed while being the exact command
> everybody checked.
>
> Then, to see it for yourself rather than take my word for it:
>
> ```powershell
> pnpm smoke
> ```
>
> It should end `all 85 routes answer`. §4 explains what it does and does not
> prove.

Still to do, and only you can do them:

- **Run `install-services.ps1` as Administrator.** The box above. It is one
  command and it closes three things at once: the ERP becomes a service, the
  nightly backup becomes a task, and the restart puts today's build on port
  3000 so the sidebar stops linking at 404s.
- **Fill in day one** — `/fr/setup`, four forms. `company_identity`,
  `bank_account`, `vat_rate` and `numbering_series` are all still empty, which
  means **nothing can be issued at all**: no devis, no facture, no bon de
  livraison. Every screen that builds a document is gated on it, and the gate
  works — it is the forms behind it that have never been filled in. This is
  twenty minutes with the company's papers in front of you, and until it is
  done the ERP can record work but cannot produce a single document.
- **Windows auto-login** (`netplwiz`) plus the lock-screen scheduled task —
  §3. Docker Desktop needs a logged-in session, so the database does not come
  back on its own without this.
- **The BIOS setting**: ThinkCentre → **F1** → Power → *After Power Loss* →
  **Power On**. No script can reach it. §3.
- **Give the backup somewhere off this disk to go.** As of 30 Aug there IS a
  backup — nightly, and it restores every dump into a scratch database and
  compares every row before calling it good (§5b). But `BACKUP_LOCAL_PATH` is
  still the leftover POSIX path from the VPS plan, so it lands in
  `.data\backups`, on the same disk as the database. That covers a mistake and
  nothing else. Plug in an external drive and set the path.
- **Optional, whenever you like:** `node scripts\clean-test-litter.mjs` reports
  the 276 audit rows and 131 files the test suite left in the application
  database and file store before it was given its own (see
  `docs/DECISIONS/2026-08-28-the-tests-had-their-own-database-taken-away.md`).
  It removes nothing without `--yes`. Deleting audit rows is a deliberate act,
  so it is yours to make.
- **`docs/DECISIONS/2026-08-26-who-sees-margin.md`** — does the Commercial keep
  `offers.margin.view`? Screen 12 and `src/auth/can.ts` disagree, and I did not
  pick one for you.

### Finding things in the Zero Trust dashboard

It gets redesigned; **URLs rot, menu names survive**. Navigate by name:
**Access controls → Applications**, **Access controls → Policies**,
**Integrations → Identity providers**. Applications and policies are separate
objects — a reusable policy attached to no application guards no hostname.

---

## 1 · Cloudflare Access — done

### Why it is not optional

The ERP already refuses everyone: every page redirects to sign-in, and Entra is
pinned to the SUPSERV tenant so a Microsoft account from outside the company is
turned away by Microsoft before it reaches our code. That is verified — from
outside, through the tunnel — and held down by
`tests/unit/route-auth.test.ts`.

But right now what answers the internet is a **Next.js development server**. It
ships unminified source and readable stack traces. Access means a scanner
probing for `/wp-admin` is answered by Cloudflare, in Algiers, and never reaches
the machine under the desk in Adrar.

Two doors, neither depending on the other. If Access were removed tomorrow,
Entra still decides who gets in — the app reads no network header for identity,
not Tailscale's and not `Cf-Access-Authenticated-User-Email`.

### What is actually configured (done — 2026-08-28)

The Zero Trust dashboard gets redesigned; URLs rot, menu names survive.
Navigate by name: **Access controls → Applications**, **Access controls →
Policies**, **Integrations → Identity providers**.

**Application** `SUPSERV ERP` — self-hosted, destination `erp.supserv-dz.com`,
session duration 24 hours.

**Policy** `SUPSERV people` — Allow, with two OR'd includes:

| Type | Selector | Value |
|---|---|---|
| Include | Emails | `dahadjabderrahman@gmail.com` |
| Include | Emails ending in | `@supserv.dz` |

**Login methods** — *Accept all available identity providers* is **on**, so the
sign-in page offers both:

- **Microsoft Entra ID** — the normal way in. Same directory as the mailboxes.
  Carries MFA through (`amr: [pwd, mfa]`) and passes Entra group membership.
- **Cloudflare one-time PIN** — the way back in if Entra breaks. Emails a code.

Both the Gmail address and the PIN method are deliberate fallbacks, not
leftovers. See `docs/DECISIONS/2026-08-28-entra-is-the-way-in.md` for why they
stay, and why the policy had to be widened *before* Entra was switched on.

### Why the order matters

Access evaluates the policy **after** the identity provider has authenticated
somebody. Entra can only ever return an `@supserv.dz` address — never a Gmail
one. Turning Entra on while the policy still listed only the Gmail address would
have authenticated correctly and then denied, locking the only administrator out
of the ERP with the Cloudflare dashboard as the sole way back.

Widen, verify, then narrow. Never the other way round.

### Check it worked

Open `https://erp.supserv-dz.com` **in a private window**. You should get
Cloudflare's own page, *before* anything from the ERP, now offering **Microsoft
Entra ID** as well as the email-code option. Sign in with
`abderrahmane.dahadj@supserv.dz`. If you land straight on the SUPSERV sign-in
page, the policy is not attached to the right hostname.

### The thing that will bite

**The Entra client secret expires.** When it does nobody can sign in, and the
error will not say why. It lives on the `Cloudflare Access` app registration
(client ID `00f3da7b-8d80-4f93-b3c0-9a248c136e0a`) under **Certificates &
secrets**. Note its expiry date here and set a reminder a month before:

    Client secret expires: ____________________

---

## 2 · Entra — the redirect URI

Sign-in is Microsoft. Microsoft will only send somebody back to an address you
have registered, so the new one has to be added or sign-in fails with an
`AADSTS50011` error.

**Direct link:**

```
https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade
```

1. Sign in as the Gérant account.
2. **App registrations** → **All applications** → open the ERP app.
   Its **Application (client) ID** is `a6dcd142-9866-416f-ad89-c9f39e18d4c3`,
   which is how to recognise it if the name is not obvious.
3. Left menu → **Authentication**.
4. Under **Web** → **Redirect URIs** → **Add URI**, paste exactly:

```
https://erp.supserv-dz.com/api/auth/callback/microsoft
```

5. **Save**.

**Keep `http://localhost:3000/api/auth/callback/microsoft`.** Do not remove it.
That is what lets somebody sitting at the mini PC sign in with the fibre down,
and it is the way back in if the tunnel ever misbehaves.

Exactly as written: `https`, no trailing slash, no capital letters. Microsoft
compares it byte for byte.

### Then tell me

I change three lines in `.env` — `APP_URL`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`
— and restart. I have deliberately not done it yet: `BETTER_AUTH_URL` is what
the sign-in redirect is built from, so flipping it before Entra knows the new
URI would break sign-in at **both** addresses and lock everyone out.

---

## 3 · Making it survive a reboot

### Run this once

Right-click PowerShell → **Run as administrator**:

```powershell
cd C:\SUPSERV-ERP
powershell -ExecutionPolicy Bypass -File scripts\server\install-services.ps1
```

That does four things:

- **cloudflared becomes a Windows service**, set to Automatic. The tunnel stops
  being a process in somebody's terminal and starts being infrastructure.
- **The ERP becomes a scheduled task** that runs at startup as SYSTEM, waits for
  the database, and serves the **production build** on port 3000. It restarts
  itself up to three times if it dies.
- **Docker Desktop starts on login**, and the `supserv-db` container is set to
  `restart: unless-stopped` — which it already was.
- It **tells you what is still broken**, which is the next section.

### Check it

```powershell
powershell -ExecutionPolicy Bypass -File scripts\server\mode.ps1 status
```

### The database needs somebody logged in — so Windows logs itself in

**Docker Desktop on Windows runs inside a user session. There is no supported
way to run it as a service.** So after a power cut this machine boots, starts
cloudflared, starts the ERP — and the ERP has no database, because nobody logged
in. `run-erp.ps1` waits ten minutes for Postgres and then writes a very clear
line in `.data\server.log` saying exactly that.

**Decided 27 August 2026: automatic login, with the screen locked straight
after.** Docker stays. The reasoning, and what it costs, is in
`docs/DECISIONS/2026-08-27-docker-at-boot.md` — read that before changing any of
this, because the second step below is a condition of the decision, not a
nicety.

#### Step 1 — automatic login

Windows key + R, type `netplwiz`, Enter.

Untick **"Users must enter a user name and password to use this computer"**,
click OK, and type the password twice when asked.

That stores it as an **LSA secret** — encrypted, not readable by an ordinary
process. Sysinternals **Autologon** does the same thing and is fine too.

**Do not use the registry method.** Every "enable autologon" page on the web
tells you to write `DefaultUserName` / `DefaultPassword` / `AutoAdminLogon` into
`HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon`. `DefaultPassword`
there is **plain text**, readable by anything running on the machine. There is
no reason to accept that when `netplwiz` exists.

If the tickbox is not there, it is hidden by the passwordless-sign-in setting:
Settings → Accounts → Sign-in options → turn off **"Require Windows Hello
sign-in for Microsoft accounts"**, then reopen `netplwiz`.

#### Step 2 — lock the screen immediately after

Automatic login without this leaves an open, signed-in desktop for anyone who
walks up to the machine. In an Administrator PowerShell, once:

```powershell
$action  = New-ScheduledTaskAction -Execute "rundll32.exe" -Argument "user32.dll,LockWorkStation"
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "Lock after autologon" -Action $action -Trigger $trigger -RunLevel Limited -Force
```

Windows signs in, Docker Desktop starts, the screen locks. The database comes up
with nobody looking at a desktop.

#### Step 3 — check it, by actually pulling the plug

Shut down, wait, power on, and **do not touch the machine**. After about five
minutes `https://erp.supserv-dz.com` should answer and `.data\server.log` should
say `database is up`. If it says it gave up waiting, the wait is too short for a
cold boot on this hardware — raise it in `scripts\server\run-erp.ps1` rather
than guessing at Docker.

#### The two options not taken

**Native PostgreSQL as a Windows service** removes Docker from the critical path
entirely, at the cost of one dump-install-restore. It was my recommendation and
it remains the fallback if automatic login turns out to be unreliable.

**The Ubuntu migration** — `docs/SERVER.md` §3 — solves this along with the fact
that **Windows 10 stopped receiving security updates in October 2025** and this
machine cannot run Windows 11. That is still the destination. Everything above
is a bridge to it.

### The BIOS setting, which no script can reach

On a ThinkCentre, tap **F1** at boot → **Power** → **After Power Loss** → set to
**Power On**.

The default is *Power Off*. That is why most home servers stay dead after a cut
until somebody notices and presses the button. Do it next time the case is open
for the RAM.

---

## 4 · Restarting it

**Double-click `restart-erp.cmd`** in `C:\SUPSERV-ERP`. Say yes to Windows.

That is the whole procedure. It stops the task, kills whatever is still holding
port 3000, starts the task again, and then **waits until the port is actually
listening** before telling you it worked.

### Why it needs to ask permission

The scheduled task runs as **SYSTEM**, so stopping it requires Administrator.
An ordinary PowerShell window produces three separate `Access is denied`
messages — one each for `Stop-ScheduledTask`, `Stop-Process` and
`Start-ScheduledTask` — and not one of them says *this window is not elevated*,
which is the only thing wrong. That was diagnosed by hand eight times in one
evening before this script existed.

It kills **by port, not by name**. `node` also runs this repository's tooling,
and `Stop-Process -Name node` would take a running build with it.

### After a restart, ask the ERP whether it is actually there

```
pnpm smoke
```

It asks every one of the eighty-five routes in `docs/SCREENS.md` whether it
answers, and expects each to send a signed-out visitor to the sign-in page. It
takes about ten seconds and needs nothing seeded — every screen checks the
session before it reads anything, so a route that exists always answers the
same way.

By default it asks `http://127.0.0.1:3000` — whatever is actually serving, dev
build or production. Point it somewhere else with `--base`:

```
pnpm smoke --base http://127.0.0.1:3100
```

**Why this exists.** On 30 August `/fr/reports` and `/fr/dashboard` returned
**404 for two days** while the sidebar linked straight at them — the process on
port 3000 was hand-started and serving a build from before those screens
existed. Nothing in the test suite could have noticed: `screen-coverage.mjs`
checks that a `page.tsx` is on disk, and a file on disk is not a route that
answers. This is the cheapest check that would have caught it, and it is the
one to run after every restart and every deploy.

What it does **not** do is render a page body — it stops at the redirect.

### And the same question from behind the door

`pnpm smoke` proves a screen answers. This proves it renders:

```powershell
# a spare copy on the TEST database, in one window
$env:DATABASE_URL = "postgres://supserv:devpassword@localhost:5432/supserv_test"
pnpm exec next start -p 3100

# in another
$env:DATABASE_URL = "postgres://supserv:devpassword@localhost:5432/supserv_test"
pnpm smoke:in
```

It signs itself in and asks every screen for its HTML, expecting the sidebar to
be around it. A `404` for a record that does not exist is fine and is reported
as such; a `500`, a bounce back to sign-in, or a bare page with no shell is not.

**Both windows must be on the same database, and it must not be the real one.**
It seeds a user, gives them Gérant, mints a session, and deletes all three at
the end whether it passes or fails — but a seeded user is still a row, and it
has no business in `supserv`.

The session is minted by Better Auth's own code — `internalAdapter` for the
user and the session, `makeSignature` for the cookie, with the secret the
library already reads from `.env`. The token never leaves the process and
nothing prints it. There is no back door in the application: take the script
away and there is no other way in but Entra.

---

## 5 · Two modes, one port

While we are building together, the dev server is what you want — you see
changes as they are made. For a machine acting as a server, the production build
is what you want. Both listen on 3000, and the tunnel points at 3000, so
switching is one command and the URL never changes.

```powershell
scripts\server\mode.ps1 dev      # hot reload, while we work
scripts\server\mode.ps1 server   # production build, runs as the scheduled task
scripts\server\mode.ps1 status   # what is running right now
```

**Before the first real client goes into the database, end in `server` mode.**
That is the line where the dev server stops being an acceptable thing to have
facing the internet.

---

## 5b · Backups — taken, verified, and restorable

Two scripts and one scheduled task. `scripts\server\install-services.ps1`
registers **SUPSERV backup** to run `scripts\server\backup.ps1` daily at the
time in `BACKUP_AT`, as SYSTEM, catching up if the machine was off.

### What a run does

1. `pg_dump -Fc` of `supserv`, inside the container, copied out with `docker cp`
   — never piped through PowerShell, which puts a text encoder on the pipeline
   and quietly corrupts a binary dump.
2. **Restores that dump into a scratch database and compares every row of every
   table against the live one.** If a single count disagrees, or a table is
   missing on either side, the run fails and says so.
3. Zips the working files.
4. Writes `last-backup.json` beside the backups **and** into `.data\`, which is
   the copy screen 66 reads.
5. Keeps 14 days of dailies plus the first backup of each month for a year.

The verification is the point. `.env` has said since the day it was written
that *a backup you have never restored is not a backup*, and a dump that exits 0
proves only that the command ran.

### The monthly drill — five minutes, no risk

```powershell
cd C:\SUPSERV-ERP
powershell -ExecutionPolicy Bypass -File scripts\server\restore.ps1
```

With no arguments it lists what exists, restores the newest dump into a
throwaway database, and prints the row counts. It cannot touch `supserv` by
accident: that needs `-Into supserv -Force`, and even then it refuses while
anything is serving on port 3000 and dumps the current database first.

### The real thing

```powershell
Stop-ScheduledTask -TaskName 'SUPSERV ERP'
powershell -ExecutionPolicy Bypass -File scripts\server\restore.ps1 `
  -From supserv-2026-08-30-0230.dump -Into supserv -Force
# then expand files-<same stamp>.zip into .data\files
Start-ScheduledTask -TaskName 'SUPSERV ERP'
```

Open `/settings/storage` afterwards. It lists every file a record points at and
cannot find — that screen is how you know the database half and the files half
came back matching.

### Two things it does NOT back up, deliberately

- **`.env`.** It holds `MS_CLIENT_SECRET` and the database password. A copy on a
  USB drive in a drawer is a copy of the company's credentials in a drawer.
  Rebuilding a machine means writing a new `.env` from `.env.example` plus the
  password manager. That is a feature.
- **`.next`.** A build output. `pnpm build` reproduces it from git.

### The gap that is still yours

`BACKUP_LOCAL_PATH` in `.env` still says `/mnt/usb-backup`, which is a POSIX
path left over from when this was going to be a VPS. The script refuses to
invent `C:\mnt\usb-backup` from it — a backup that looks configured and sits on
the disk it is protecting is worse than none — so it falls back to
`C:\SUPSERV-ERP\.data\backups` and prints a warning every night.

**That covers a mistake and nothing else.** Not the disk, not the machine, not
the room. Plug in an external drive, set `BACKUP_LOCAL_PATH` to its path, and
run `scripts\server\backup.ps1` once by hand to confirm it lands there. Screen
66 shows **Same disk** in amber until you do.

---

## 6 · Where things are

| | |
|---|---|
| Public URL | `https://erp.supserv-dz.com` |
| From the mini PC | `http://localhost:3000` — bypasses Cloudflare entirely |
| From the office LAN | `http://192.168.1.2:3000` |
| Tunnel name / id | `supservpc01` / `cd39496e-95da-4913-a07c-f53c31c8cb4e` |
| Tunnel config | `C:\Users\Abderrahmane\.cloudflared\config.yml` — named in the service's `ImagePath` |
| Tunnel log | `C:\SUPSERV-ERP\.data\cloudflared.log` |
| App log (service mode) | `C:\SUPSERV-ERP\.data\server.log` |
| Database | Docker container `supserv-db`, bound to `127.0.0.1:5432` only |
| Test database | `supserv_test`, same container. `pnpm test` uses it and refuses to use `supserv` |

**The way back in, always:** AnyDesk to the mini PC, open `http://localhost:3000`.
That path touches neither Cloudflare nor the tunnel, so it keeps working no
matter what is misconfigured above.

### How to tell whether the tunnel is actually up — and how NOT to

**Loading `https://erp.supserv-dz.com` and getting the Access login page proves
nothing.** Cloudflare Access answers unauthenticated requests *at the edge*.
That request never reaches this machine, so a healthy-looking redirect is
exactly what a completely dead tunnel produces too.

That cost an evening on 27 August: the service said `Running`, the URL returned
a clean 302, and the tunnel had **zero connections** the whole time. The only
requests that revealed it were the ones that had already passed Access — which
is why the failure showed up as error 1033 on the Microsoft sign-in callback and
nowhere else.

Three checks that mean something, in order of how much they prove:

```powershell
# 1. Ask Cloudflare, not Windows. This is the one that counts.
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" `
  --origincert C:\Users\Abderrahmane\.cloudflared\cert.pem `
  tunnel info supservpc01

# 2. Read the connector's own log.
Get-Content C:\SUPSERV-ERP\.data\cloudflared.log -Tail 30

# 3. The dashboard: Zero Trust > Networks > Tunnels. Healthy / Degraded / Down.
```

`Get-Service cloudflared` returning `Running` is **not** on that list. It means a
process exists. It does not mean the process is running your tunnel.

### If the tunnel is down and you need to actually sign in

The page loads at `localhost:3000` no matter what. **Signing in there is a
different question**, and it will fail while `.env` says this:

```
BETTER_AUTH_URL=https://erp.supserv-dz.com
```

Sign-in sends you to Microsoft and Microsoft sends you back — to whatever
address that line names. If the tunnel is down, that address is unreachable, so
you get as far as the Microsoft page and no further.

To sign in at the machine itself, edit `C:\SUPSERV-ERP\.env`:

```
BETTER_AUTH_URL=http://localhost:3000
```

then restart the server (`scripts\server\mode.ps1 server`, or restart the
"SUPSERV ERP" scheduled task). `http://localhost:3000/api/auth/callback/microsoft`
is already registered in Entra alongside the public one, so nothing needs
changing on Microsoft's side.

**Put it back to `https://erp.supserv-dz.com` when the tunnel is working
again.** While it says `localhost`, the public address loads the app and then
cannot complete a sign-in — the same failure, pointed the other way.

---

## 7 · What is secure, and what is not

**Verified, not assumed:**

- Every page and route handler is behind a session. `src/proxy.ts` does *not*
  authenticate — it only routes locales — so protection comes from the `(app)`
  layout, and `tests/unit/route-auth.test.ts` now asserts that exactly two
  things are reachable without one: the sign-in page and Better Auth's own
  handler. Move a page out of that group and the test fails.
- Checked live through the tunnel: `/fr/companies`, `/fr/setup/identity`,
  `/fr/people` and `/fr/settings/bin` all redirect to sign-in.
- Entra is pinned to the SUPSERV tenant. An outside Microsoft account is refused
  by Microsoft, one step before our code.
- Postgres listens on `127.0.0.1` only. It is not reachable from the office LAN,
  let alone the internet.
- The tunnel publishes exactly one thing: `erp.supserv-dz.com → localhost:3000`.
  Nothing else on the machine is reachable through it regardless of what else is
  listening, and no port is open on the router.
- `supserv.dz` was never touched. The Microsoft 365 MX records did not move.

**Not secure yet, in order:**

1. **No Access policy.** §1. Today the only thing between the internet and a dev
   server is the app's own sign-in.
2. **A dev server is what is running.** §4.
3. **Windows 10 is unpatched since October 2025** and this machine cannot run
   Windows 11 — `docs/SERVER.md` §3. It is now also reachable from the internet.
   This moves the Ubuntu migration from "good hygiene" to "the next real task".
4. **The backup is on the same disk as the database.** No longer "there is no
   backup" — §5b, nightly and verified by a real restore. But until
   `BACKUP_LOCAL_PATH` names an external drive, one dead disk still takes the
   ERP and every copy of it together. Nothing in the database is irreplaceable
   today; that stops being true the first day you type in a real invoice.
