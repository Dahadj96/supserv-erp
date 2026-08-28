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
| 3 | **Survive a reboot** — services installed, reboot tested | **done**, except auto-login + BIOS below |

Still to do, and only you can do them:

- **Windows auto-login** (`netplwiz`) plus the lock-screen scheduled task —
  §3. Docker Desktop needs a logged-in session, so the database does not come
  back on its own without this.
- **The BIOS setting**: ThinkCentre → **F1** → Power → *After Power Loss* →
  **Power On**. No script can reach it. §3.
- **Take a backup.** There has never been one. Real mail, classifications and
  read state now live only in the Postgres container on that one machine.
  This is the largest single risk in the whole setup.
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
4. **No backup has ever been taken.** `docs/SERVER.md` §2 is blunt about this
   and it is still true. A machine that is now published to the internet and has
   no backup is a bad combination. Nothing in the database is irreplaceable
   today; that stops being true the first day you type in a real invoice.
