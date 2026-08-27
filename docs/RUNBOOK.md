# RUNBOOK — the three things left, and how the mini PC becomes a server

Written 23 Aug 2026, the day `erp.supserv-dz.com` went live.
**Re-checked 27 Aug 2026 — the state below had changed. Read this box first.**

> ## THE TUNNEL IS DOWN
>
> As of 27 Aug: `cloudflared` is **not a service, not a scheduled task, and not a
> running process**, and `https://erp.supserv-dz.com` answers **530** — Cloudflare
> error 1033, origin tunnel not connected.
>
> This is not a fault. It is exactly what §3 warned about: the tunnel has only ever
> been a foreground process in a terminal I opened, and it died when that session
> ended. §3 is what fixes it, permanently.
>
> **The order in the table below has therefore changed.** Do §1 and §2 while the
> site is down — it is a free window, because there is nothing behind the door to
> protect. Then §3 brings it back up already locked.

| Order | § | What | Who | How long |
|---|---|---|---|---|
| 1st | 1 | **Cloudflare Access** — attach the policy to an application | you | 5 min |
| 2nd | 2 | **Entra redirect URI** — so sign-in works on the new address | you | 2 min |
| 3rd | 3 | **Survive a reboot** — and bring the tunnel back at all | one command + one decision | 10 min |

Also outstanding, and not in this file:

- **`docs/DECISIONS/2026-08-26-who-sees-margin.md`** — does the Commercial keep
  `offers.margin.view`? Screen 12 and `src/auth/can.ts` disagree, and I did not
  pick one for you.
- **When does the new desk PC arrive?** It is the single fact that decides §3's
  Docker-at-boot question, and it has been asked three times now.

### One correction to §1 below

The Zero Trust dashboard has been redesigned since this was written. **Policies
and Applications are now separate things**, and the policy `SUPSERV people` that
already exists is a *reusable policy attached to nothing*. A policy on its own
guards no hostname. In the new layout, create the application first, and on its
Policies step choose **Select existing policies** and tick `SUPSERV people`.

---

## 1 · Cloudflare Access — do this first

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

### The clicks

1. **dash.cloudflare.com** → **Zero Trust** (left sidebar)
2. **Access** → **Applications** → **Add an application**
3. Choose **Self-hosted**

| Field | Value |
|---|---|
| Application name | `SUPSERV ERP` |
| Session duration | `24 hours` |
| Subdomain | `erp` |
| Domain | `supserv-dz.com` |
| Path | *(leave empty)* |

4. **Next**, then add a policy:

| Field | Value |
|---|---|
| Policy name | `SUPSERV people` |
| Action | **Allow** |
| Include → selector | **Emails ending in** |
| Value | `@supserv.dz` |

If the Microsoft accounts are not all on `@supserv.dz`, use the **Emails**
selector and list them one at a time. Start narrow — widening it later takes ten
seconds, and a policy that is too generous is not visible until it matters.

5. Leave the login method as the **One-time PIN**. Cloudflare emails a code.
   Wiring Access to Entra as an identity provider is tidier and can wait.
6. **Save**.

### Check it worked

Open `https://erp.supserv-dz.com` **in a private window**. You should get
Cloudflare's own page asking for an email, *before* anything from the ERP. If
you land straight on the SUPSERV sign-in page, the policy is not attached to the
right hostname.

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

## 4 · Two modes, one port

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

## 5 · Where things are

| | |
|---|---|
| Public URL | `https://erp.supserv-dz.com` |
| From the mini PC | `http://localhost:3000` — bypasses Cloudflare entirely |
| From the office LAN | `http://192.168.1.2:3000` |
| Tunnel name / id | `supservpc01` / `cd39496e-95da-4913-a07c-f53c31c8cb4e` |
| Tunnel config | `C:\Users\Abderrahmane\.cloudflared\config.yml` |
| App log (service mode) | `C:\SUPSERV-ERP\.data\server.log` |
| Database | Docker container `supserv-db`, bound to `127.0.0.1:5432` only |

**The way back in, always:** AnyDesk to the mini PC, open `http://localhost:3000`.
That path touches neither Cloudflare nor the tunnel, so it keeps working no
matter what is misconfigured above.

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

## 6 · What is secure, and what is not

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
4. **No backup has ever been taken.** `docs/SERVER.md` §2 is blunt about this
   and it is still true. A machine that is now published to the internet and has
   no backup is a bad combination. Nothing in the database is irreplaceable
   today; that stops being true the first day you type in a real invoice.
