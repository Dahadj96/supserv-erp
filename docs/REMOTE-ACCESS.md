# REACHING THE ERP FROM OUTSIDE THE OFFICE

**Decision: Cloudflare Tunnel on `erp.supserv-dz.com`.** Written 22 Aug 2026.

`docs/SERVER.md` §4 rejected Cloudflare for one specific reason — the free plan
needs the domain's nameservers, and moving `supserv.dz` would move the MX records
that carry Microsoft 365 email with them. That objection does not apply here:
**`supserv-dz.com` is a second domain, already on Cloudflare, and carries no
email.** This is the escape hatch that page described, and the conditions for
taking it are met.

`supserv.dz` is not touched. Company email does not move.

---

## 1. What this is, in one paragraph

`cloudflared` runs on the mini PC and dials **out** to Cloudflare. Cloudflare
publishes `erp.supserv-dz.com` and sends requests back down that connection.

- **No port is opened.** No router configuration, no dynamic DNS, no public IP.
- **CGNAT does not matter.** The connection is outbound.
- **Real HTTPS**, terminated by Cloudflare, free.
- If the mini PC is off, the hostname simply returns an error. Nothing is
  exposed while it is down.

---

## 2. The part that is not optional: Cloudflare Access

A tunnel makes the ERP **public**. Bots find a new hostname within minutes —
that is not a worry, it is a certainty.

The ERP already refuses everybody: every route requires an Entra session, and
Entra is pinned to the SUPSERV tenant, so a Microsoft account from outside the
company is turned away by Microsoft before the request reaches our code.

**Put Cloudflare Access in front of it anyway.** It is free for up to 50 users
and it means unauthenticated traffic never reaches the mini PC at all — a
scanner probing for `/wp-admin` is answered by Cloudflare, not by a Next.js
server sitting under somebody's desk in Adrar.

Two doors, and neither depends on the other. If Access were removed tomorrow,
Entra still decides who gets in; the app reads no network header for identity.

---

## 3. What you do, from AnyDesk — in order

### Step 1 · Create the tunnel

Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels** →
**Create a tunnel** → **Cloudflared**.

- Name it `supservpc01`.
- Choose **Windows / 64-bit**. Cloudflare shows an install command with a long
  token in it.

> **Run that command yourself, on the mini PC, in an Administrator PowerShell.**
> The token is a credential — do not paste it into this chat, into a file in the
> repository, or anywhere I can see it. It belongs only in that command.

### Step 2 · Point the hostname at the app

Still in the tunnel's page → **Public Hostnames** → **Add a public hostname**:

| Field | Value |
|---|---|
| Subdomain | `erp` |
| Domain | `supserv-dz.com` |
| Path | *(leave empty)* |
| Type | `HTTP` |
| URL | `localhost:3000` |

`HTTP` and not `HTTPS` is correct: the leg from Cloudflare to the mini PC is the
tunnel itself, which is already encrypted. The app speaks plain HTTP on 3000.

Cloudflare creates the DNS record for you. There is nothing to add by hand.

### Step 3 · Lock it with Access

Zero Trust → **Access** → **Applications** → **Add an application** →
**Self-hosted**.

| Field | Value |
|---|---|
| Application name | `SUPSERV ERP` |
| Session duration | 24 hours |
| Public hostname | `erp.supserv-dz.com` |

Then add a policy:

| Field | Value |
|---|---|
| Policy name | `SUPSERV people` |
| Action | **Allow** |
| Include | **Emails ending in** → `@supserv.dz` |

If your Microsoft accounts are not all on `@supserv.dz`, use **Emails** and list
them one by one. Start narrow; widening it later takes ten seconds.

Leave the login method as the **one-time PIN** to begin with — Cloudflare emails
a code. Wiring Access to Entra as well is nice later and is not needed today.

### Step 4 · Tell Entra about the new address

Entra admin centre → **App registrations** → your ERP app →
**Authentication** → **Redirect URIs** → **Add URI**:

```
https://erp.supserv-dz.com/api/auth/callback/microsoft
```

**Add it. Do not remove the localhost one** — that is what makes the app still
work for whoever is sitting at the machine, and it is your way back in if the
tunnel misbehaves.

### Step 5 · Tell me when those four are done

I change three lines in `.env`, restart the app, and we test it together.

---

## 4. What changes in `.env` — my side, not yours

```ini
APP_URL=https://erp.supserv-dz.com
BETTER_AUTH_URL=https://erp.supserv-dz.com
TRUSTED_ORIGINS=https://erp.supserv-dz.com
```

`BETTER_AUTH_URL` is what the sign-in redirect is built from, and it must match
the URI registered in step 4 exactly — scheme, host, no trailing slash.

`TRUSTED_ORIGINS` is new. Better Auth checks the `Origin` header against it, and
`http://localhost:3000` is always included in code, so both addresses keep
working. See `src/auth/index.ts`.

`next.config.ts` gained `allowedDevOrigins`. The Next.js **dev** server refuses
to serve its own scripts to a cross-origin request unless the host is listed —
without it the page loads and then every script 403s, which looks like a broken
app rather than a blocked origin.

**Nothing in `src/` changes to make this work.** That was the point of building
it the way it was built.

---

## 5. The dev server is behind this, and that is a temporary answer

Right now the tunnel points at `pnpm dev`, because the reason you asked for this
is to see changes as they are made.

That is fine **while the database holds nothing but test rows**. A dev server
ships unminified source and readable stack traces, and it is slower over a
tunnel than a built app.

**Before the first real client is typed in**, the tunnel points at a production
build instead:

```powershell
pnpm build
pnpm start          # same port 3000, nothing else changes
```

There is no other difference. The tunnel, the hostname, Access, and Entra all
stay exactly as they are.

---

## 6. What this does NOT change

- **`supserv.dz` is untouched.** Its nameservers, its MX records and your
  Microsoft 365 email are exactly where they were.
- **The office LAN still works with the fibre down.** `http://localhost:3000` at
  the machine, `http://192.168.1.x:3000` from another desk. The tunnel is a way
  in from outside, not the way the office works.
- **Tailscale is still the better answer for staff.** `docs/NETWORK.md` stands:
  for people who work at SUPSERV every day, a private mesh with no public
  surface is a stronger position than a public hostname behind Access. This
  tunnel exists so that *one person testing from outside* does not need to
  install anything. If it turns out three people use it daily, revisit that.

---

## 7. If it does not work

| Symptom | Where to look |
|---|---|
| `erp.supserv-dz.com` shows a Cloudflare error | The tunnel is down. Is the mini PC on? `Get-Service cloudflared` in PowerShell |
| Cloudflare asks for a PIN and never lets you in | The Access policy does not include your email. Zero Trust → Access → Applications → the policy |
| Page loads, then everything is unstyled | `allowedDevOrigins` — the hostname is not in `next.config.ts` |
| Sign-in ends on an AADSTS error | The redirect URI in Entra does not match `BETTER_AUTH_URL` byte for byte |
| Sign-in fails with a CSRF or origin error | `TRUSTED_ORIGINS` in `.env` |
| Everything works at the office, nothing from outside | The tunnel, not the app. Test `http://localhost:3000` on the mini PC first — if that works, the ERP is fine |

**The way back in, always:** AnyDesk to the mini PC and open
`http://localhost:3000`. That path does not go through Cloudflare at all, so it
keeps working no matter what is misconfigured above.
