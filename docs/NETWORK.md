# HOW PEOPLE REACH THE ERP

The server sits in the Adrar office. Your fibre is a home line, so the public
address changes and may be behind CGNAT. This page explains how everyone reaches
the ERP anyway — and what the alternatives are.

---

## 1. What Tailscale actually is

Forget the word VPN, it misleads people here. Think of it as **a private cable
between your devices that happens to be made of software.**

You install a small app on the server, on each office PC and on each phone, and
sign every one of them in **with the same account**. From that moment those
devices can see each other and nothing else can — as if they were plugged into
the same switch, even when one of them is on mobile data in a shop in Timimoun.

The important part, and the reason it solves your problem:

> **Nothing ever connects *in* to your office. Every device connects *out*.**

Your router is untouched. No port forwarding. No dynamic DNS. Your ISP can change
your public address every hour, or give you no public address at all, and none of
it matters — because nobody is ever trying to find your office from the outside.

Two more things you get, both free and both load-bearing:

- **A name that never changes.** `erp.supserv.ts.net` works from your desk, your
  house, and a phone at a supplier's counter. One address, everywhere.
- **Real HTTPS.** Tailscale issues a genuine Let's Encrypt certificate for that
  name. A real padlock, not a browser warning — which matters because the ERP uses
  secure cookies and the phone screens need it.

**And on the office LAN it is not slower.** When two Tailscale devices are on the
same network they connect **directly** to each other. Full gigabit. The traffic
does not leave the building.

---

## 2. Who installs what

Five minutes per device, once.

| Device | What to do |
|---|---|
| **The server** (Ubuntu mini PC) | `curl -fsSL https://tailscale.com/install.sh \| sh` then `sudo tailscale up` |
| **Office PCs** (Windows) | Download the installer from tailscale.com, sign in |
| **Your phone** | Tailscale from the App Store / Play Store, sign in |
| **A second phone for staff** | Same |

**Sign in with the Microsoft accounts you already have.** Tailscale supports
Microsoft Entra ID and Office 365 accounts natively, so `dahadj@supserv.dz` is the
login. Nobody invents a new password, and when someone leaves the company you
disable their Microsoft account and they lose ERP access at the same moment.

---

## 3. Three settings in the admin console, then never again

Do these on day one. The first one is the difference between a server that works
for years and one that mysteriously dies in February.

**1 · Disable key expiry on the server. This is not optional.**
By default a Tailscale machine's key expires after **180 days** and the machine
simply stops answering. On a laptop that is a security feature. On a server it is
an outage six months from now that nobody will connect to a setting they made in
August.

> Admin console → **Machines** → the server → **⋯** → **Disable key expiry**

Tailscale documents this as the right thing to do for trusted always-on servers,
and it is available on every plan including free.

**2 · Turn on MagicDNS.** Gives you `erp` as a name instead of `100.x.y.z`.
> Admin console → **DNS** → **Enable MagicDNS**

**3 · Turn on HTTPS certificates.**
> Admin console → **DNS** → **Enable HTTPS**

Then on the server, one command publishes the ERP with a real certificate:

```bash
sudo tailscale cert erp.<your-tailnet>.ts.net
```

---

## 4. The address people actually type

**`https://erp.<your-tailnet>.ts.net`** — from a desk, from home, from a phone.
Same address, same certificate, everywhere. Put it on the home screen of the
office PCs and as a shortcut on each phone.

**Keep one fallback and write it on a card in the drawer:**

```
http://192.168.1.50:3000        ← office network only, no Tailscale needed
```

You will need it perhaps once. Tailscale needs the internet to introduce two
devices that have never met; once they know each other they keep talking over the
LAN, but a phone that has been off for a week, on the morning the fibre is down,
may not reconnect. That card costs nothing and saves a bad hour.

---

## 5. Is there anything free and easier? I checked all of them

Every free tier below was verified this week, because they change often.

| | Free users | Free devices | HTTPS included | Honest verdict |
|---|---|---|---|---|
| **Tailscale** | **6** | **unlimited** | **yes, real certs** | **The one that fits.** 6 users is exactly SUPSERV |
| NetBird | 5 | 100 | no | Good product, **one user short** |
| Twingate | 5 | 5 per user | no | **One user short**, and device-capped |
| ZeroTier | 1 admin, 1 network | **10 total** | no | Ten devices goes fast: server + 2 PCs + phones. And no HTTPS |
| Cloudflare Tunnel | unlimited | — | yes | Free and excellent, **but** see below |
| Just the LAN | — | — | no | Free and zero setup. No phone in a shop, no working from home |

**Why not Cloudflare Tunnel.** It is genuinely good and genuinely free, and it
also works behind CGNAT. The problem is the domain: on the free plan it requires
moving **supserv.dz's nameservers to Cloudflare** — which moves the MX records
carrying your Microsoft 365 email. Breaking company email to publish an internal
tool is a bad trade. If you ever need a real public endpoint (a client portal,
say), buy a separate domain for ~€10/year and put *that* on Cloudflare. Your
website and your email never move.

**Why not plain WireGuard, or port forwarding with dynamic DNS.** Both need
something to connect *to* — a public address and an open port. If Algérie Télécom
has you behind CGNAT, no amount of router configuration will make it work, and you
cannot tell from inside. Tailscale sidesteps the question entirely, which is why
it is the answer whether or not you are behind CGNAT.

**The genuinely simplest option is LAN-only**, and it deserves a fair hearing:
install nothing, reach the ERP at `http://192.168.1.50:3000` inside the office,
done. What you lose is screens 61 and 86 — photographing a product in a shop,
capturing a price at a counter, approving an offer from the car. Those were
designed because they are the things that actually happen away from a desk. Five
minutes of Tailscale per device buys them back.

---

## 6. What happens when Tailscale stops fitting

**At seven users.** The free plan caps at six, and SUPSERV is two to six today.
Two ways out when you grow, and neither is urgent:

- **Pay** — $6/user/month. At eight people that is about $48/month, which is real
  money against a €0 bill.
- **Headscale** — the open-source Tailscale control server. Same client apps, no
  user limit, free forever. It does need to be reachable from the internet, so it
  wants a small rented box — which is the one thing you were avoiding. Know it
  exists; do not build it now.

There is no urgency here. You are two people. Revisit it the day you hire the
seventh.

---

## 7. Security, briefly and honestly

This design is **more** closed than a VPS, not less.

- Nothing is exposed to the public internet. There is no address to scan, no login
  page for anyone to find.
- Every connection is encrypted device-to-device with WireGuard.
- Identity comes from your Microsoft tenant. Disabling someone's M365 account
  removes their ERP access in the same action — no separate list to remember.
- The one machine reachable from outside is **none**.

Compared with a VPS, where a public SSH port and a public login page are scanned
by bots within minutes of the server booting, this is the stronger position.

The real risks on an office server are not network attacks. They are **the disk
dying** and **somebody opening a bad attachment on the same machine**. Both are
covered in `docs/SERVER.md` §2 and §3, and both matter more than anything on this
page.
