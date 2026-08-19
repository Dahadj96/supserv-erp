# GETTING OUT OF TAILSCALE — BEFORE YOU ARE IN IT

You are right to plan the exit now. This page is that plan.

**The short version: the exit costs about two hours and four environment
variables, because the ERP does not know Tailscale exists.** Tailscale only
decides how packets arrive. Nothing in `src/` mentions it, and nothing will.

---

## 1. First — the four rules that keep the exit cheap

Lock-in does not happen when you adopt something. It happens when you let it
leak into the design. Four rules, and Claude Code is instructed to follow them:

**1 · Tailscale is never the login.**
Tailscale can pass identity headers to an app. **Do not use them.** Sign-in is
Better Auth + Microsoft Entra ID, exactly as designed. If the app ever learned to
trust "whoever Tailscale says you are", moving off it would mean rebuilding
authentication — the most dangerous kind of migration. Today, Tailscale carries
the packets and Microsoft says who you are. Those stay separate.

**2 · Tailscale ACLs are never the permissions.**
`src/auth/can.ts` decides who may see margin. Not a network rule. A network that
also enforces business permissions is a network you cannot replace.

**3 · The address lives in one place — `.env`.**
`APP_URL`, `BETTER_AUTH_URL` and the Traefik host rule. Nothing hardcodes a
`.ts.net` string anywhere else. Grep for `ts.net` before every release; the only
hits should be `.env` and documentation.

**4 · The LAN fallback must keep working.**
`http://192.168.1.50:3000` reachable from the office without Tailscale, forever.
It is not only for outages — **it is the proof that the app has no dependency on
Tailscale.** The day it stops working is the day something leaked in. Test it
monthly, the same Saturday you test the backup restore.

Follow those four and the exit is a configuration change. Break rule 1 and it is
a project.

---

## 2. When to leave — the trigger

**The seventh user.** That is the only hard trigger. Everything else is comfort.

Free Tailscale covers six users with unlimited devices. SUPSERV is two to six
today, so there is genuinely no hurry — but the day you hire the seventh person,
one of the four doors below opens. Decide which one *before* that day, not on it.

A softer trigger worth watching: **a client asks for a portal**, or you want the
website form to POST directly into the ERP rather than send an email. Both need a
real public endpoint. Neither is on the roadmap.

---

## 3. The four doors

### Door 1 — Business fibre with a fixed IP · *stay in the office*

The one you named, and probably the best fit for SUPSERV.

Ask the Algérie Télécom agency in Adrar **two specific questions** — not "do you
have business internet", which gets a yes that means nothing:

> 1. Est-ce que l'offre professionnelle inclut une **adresse IP publique fixe**,
>    ou est-ce que la ligne reste derrière un CGNAT comme le résidentiel ?
> 2. Quel est le tarif mensuel, et le délai d'installation à Adrar ?

Question 1 is the whole thing. A "fixed IP" that is still inside a carrier NAT is
not a public address and will not work. Get it in writing.

**You can check what you have today, free, in five minutes:**

1. Open your router's admin page and find the **WAN IP address**.
2. Open `whatismyip.com` on a PC behind that router.
3. Compare.

| What you see | What it means |
|---|---|
| The two match, and it is a normal public address | You have a **real public IP**, just dynamic. Dynamic DNS alone would work |
| Router WAN shows `100.64.x.x` – `100.127.x.x` | **CGNAT.** No port forwarding will ever work |
| Router WAN shows `10.x` or `192.168.x` and they differ | **CGNAT** (or a second router — check that first) |

Knowing this costs nothing and tells you how big Door 1 really is.

**What changes when you take it:**

```
DNS       A record  erp.supserv.dz → your fixed IP
Router    forward 443 only. Never 22, never 5432, never 3000
Traefik   Let's Encrypt HTTP-01 instead of the Tailscale certificate
.env      APP_URL / BETTER_AUTH_URL → https://erp.supserv.dz
```

**Keep Tailscale anyway, for administration.** SSH and the database stay
unreachable from the internet; only 443 is public. That is not belt-and-braces,
it is the standard shape — and it costs nothing since you already have it.

**Cost:** the difference between residential and business fibre, monthly, forever.
**Gain:** unlimited users, a real public address, and you keep the office server
working during an internet outage for everyone on the LAN.

---

### Door 2 — Rent a server · *move out of the office*

Same `docker-compose.yml`, a rented box, an A record. This is the door you
already have a plan for, and it is genuinely easy — that was the point of
choosing Docker.

**What you lose, and it is not nothing:** the office stops working when the fibre
goes down. Today, if Algérie Télécom has a bad afternoon, everyone on the switch
keeps invoicing. On a rented server, no internet means no ERP for anybody.

**What you gain:** somebody else owns uptime, power and hardware failure.

Take this door if the office ever feels like the wrong place for the machine —
not merely because you passed six users.

---

### Door 3 — Headscale · *stay closed, stay free, no user limit*

The open-source Tailscale control server. **The same client apps on every phone
and PC** — you change one setting, the login server URL. No user limit, free
forever.

The catch: Headscale itself must be reachable from the internet, so it wants a
small public endpoint. A €4/month box is enough — it only coordinates, it never
carries your traffic.

So Door 3 is not free, it is *nearly* free, and it keeps the thing you like most:
nothing about your ERP is ever exposed publicly. **If Door 1 turns out expensive
or slow in Adrar, this is the cheapest way past six users.**

---

### Door 4 — Just pay Tailscale

$6 per user per month. At eight people that is roughly $48/month.

Not the worst answer, and the only one that takes zero work — but it is a foreign
card payment every month, which is the thing you set out to avoid. Compare it
honestly against the monthly premium for business fibre in Door 1; if they are
close, Door 1 wins because it also gives you a public address you own.

---

## 4. The migration, when the day comes

Roughly two hours, and reversible at every step.

1. **Get the address.** Fixed IP, or a rented server, or Headscale running.
2. **DNS.** `erp.supserv.dz` → the new address. TTL down to 300 first.
3. **Certificate.** Point Traefik at Let's Encrypt HTTP-01. Dokploy does this.
4. **`.env`.** `APP_URL`, `BETTER_AUTH_URL`, the Traefik host rule.
5. **Entra ID.** Add the new redirect URI **beside** the old one, not instead of.
   Both work during the changeover.
6. **Test with one person** on the new address while everyone else keeps using
   `.ts.net`. Both work at once — this is why there is no cutover moment.
7. **Move everyone**, then remove the old redirect URI a week later.

Nothing in `src/` is touched. No database migration. No downtime.

**Do not delete Tailscale afterwards.** Keep it for SSH and Postgres. Those should
never be on a public address, whatever else changes.

---

## 5. The honest recommendation

**Start on Tailscale, and expect Door 1.**

You are two people. Six is far away, and by the time you reach it the ERP will be
running real work, which is exactly when you will want a fixed IP anyway — for
the client portal, for the website form, for the accountant's read-only access.

Ask Algérie Télécom the two questions **now**, while it costs nothing to know.
If a fixed IP in Adrar is cheap and available, you may take Door 1 earlier than
six users simply because it is tidy. If it is expensive or unavailable, you know
today that Door 3 is your answer, and you have a year to arrange it calmly.

The thing you must not do is discover the answer on the morning you hire someone.
