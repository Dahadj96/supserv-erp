# THE OFFICE SERVER

**Decision: the ERP runs on a mini PC in the SUPSERV office in Adrar.**
No VPS. No monthly hosting bill. Written 19 Aug 2026.

---

## 1. Is this a good idea? Yes — and for a better reason than price

Your arithmetic is right. A used ThinkCentre or HP mini with 8 GB RAM and an
8th–10th generation Intel costs less than one year of any VPS, Algerian or
foreign, and you own it afterwards. For an ERP used by two to six people in one
office, it is more machine than a €10/month VPS gives you.

But the stronger argument is one you did not make:

**When the fibre goes down, an office server keeps working. A VPS does not.**

Everyone in the office is on the same switch as the machine. If Algérie Télécom
has a bad afternoon, you can still issue an invoice, open a dossier, and price an
offer. Only email and SharePoint filing pause, and they catch up by themselves
when the line returns. In Adrar that is not a small thing — it is the difference
between a quiet afternoon and a lost one.

Two more you get for free: **your client data never leaves your office** — which
for a cahier des charges under a competitive tender is a real position, not a
talking point — and **there is no card to fail** and no account to be suspended
from abroad.

So: yes. This is the right call. Below is what it takes to do it properly, and
the two places where it can genuinely bite you.

---

## 2. The one real risk: backup

Everything else on this page is a detail. This is not.

A VPS provider takes snapshots whether you think about it or not. **A mini PC
under a desk does nothing unless you make it.** If that disk dies — and consumer
SSDs do — or the office floods, or somebody walks off with it, SARL SUPSERV loses
every invoice, every offer, every tender dossier, at once.

**The rule: three copies, two kinds of media, one of them off-site.**
And the off-site copy is already paid for.

| Copy | Where | How often | Cost |
|---|---|---|---|
| 1 · live | the mini PC | continuous | — |
| 2 · local | an external USB SSD kept plugged in | nightly | one-time, ~€30 |
| 3 · **off-site** | **SharePoint**, encrypted, via Graph | nightly | **already paid** |

Copy 3 is the one that matters, and you already own it. The nightly job dumps
Postgres, encrypts it, and uploads it to a SharePoint folder. Microsoft keeps it
in their datacentre with versioning. If the office burns down, the company is
still there.

**A backup you have never restored is not a backup.** Put a reminder in the
calendar: on the first Saturday of every month, restore last night's dump into a
throwaway database and count the invoices. Ten minutes. It is the only way to
find out that the job has been silently writing empty files since March.

---

## 3. The machine you have — SUPSERVPC01

From the screenshot:

| | |
|---|---|
| CPU | **Intel Core i5-6500** @ 3.2 GHz — 4 cores, Skylake, 2015 |
| RAM | **8 GB** (7.89 usable) |
| OS | **Windows 10 Pro**, activated |
| Name | SUPSERVPC01 |

**The processor is fine.** Four cores at 3.2 GHz is more than this ERP needs for
six people. Postgres, Next.js, the worker and the PDF renderer will not trouble
it. Do not replace it for CPU reasons.

**8 GB is the constraint, and it is the cheapest thing to fix.** Windows takes
2–3 GB before anything else starts; Docker Desktop takes more; then Postgres, the
app, the worker, the renderer, and OCR — which is the greedy one. It will run, and
it will swap.

> **Buy 16 GB of DDR4 and fit it. Around €30.** It is the single highest-value
> thing you can do to this machine, and it costs a tenth of a new one.

### But there are two facts about this PC that change the plan

**1 · Windows 10 stopped receiving security updates on 14 October 2025.** That was
ten months ago. This machine reads email and browses the web every day, and it is
no longer being patched. Consumer Extended Security Updates run to October 2027,
but that is a paid stopgap, not a fix.

**2 · It cannot run Windows 11.** Windows 11 requires an 8th-generation Intel or
newer. The i5-6500 is 6th generation. There is no supported upgrade path.

So this machine is on an operating system with no future. That is uncomfortable
for a PC that browses the web — and unacceptable for one that will hold every
invoice SARL SUPSERV has ever issued.

### Which makes the answer cleaner than the one I gave before

Do **not** keep Windows on it and buy a second machine for the server. Do the
opposite:

| | Machine | Becomes | Why |
|---|---|---|---|
| **This one** — SUPSERVPC01 | **Ubuntu Server 24.04 LTS** + 16 GB RAM | **The ERP server** | Linux does not care that Intel calls it old. Supported until 2029, patched, no licence, and the unsupported Windows disappears entirely |
| **A new mini PC** — €150–250 | Windows 11 | **The desk PC** for email, browsing, documents | Only this needs to be modern, because only this faces the web |

This is the same money you were going to spend, pointed the other way — and it
removes an unpatched Windows machine from your office instead of leaving it there.

**It also fixes the other risk.** Today the machine that browses the web would be
the machine holding the database. After the swap, they are two different boxes:
if somebody opens a bad attachment on the desk PC, the ERP is not on that disk.

**Sequence it so nothing breaks:**

1. **Now** — install Docker Desktop on SUPSERVPC01 as it is. Build and test the
   ERP. No real client data yet. Windows stays; nothing is disrupted.
2. **When the desk PC arrives** — move email, browsing and documents onto it.
3. **Then** — wipe SUPSERVPC01, install Ubuntu Server, fit the 16 GB, and it
   becomes the server. Set BIOS **"After Power Loss" → Power On** while the case
   is open for the RAM.

**Specification for the new desk PC** — modest is fine. 8th-generation Intel or
newer (for Windows 11), 8–16 GB, 256 GB SSD. It reads email; it is not the server.

### One security note about remote access

The screenshot shows an AnyDesk session with the ID visible. That is fine for
supporting a desk PC. **Do not leave unattended AnyDesk access enabled on the
machine that becomes the server** — an ID and a password is a far weaker door than
the design in `docs/NETWORK.md`, where nothing is reachable from outside at all.
Once Ubuntu is on it, administration is SSH over Tailscale.

## 4. No public IP — and it turns out you do not need one

Your fibre is a home line, so the public address changes, and it may well be
behind CGNAT, where you have no public address at all and port forwarding simply
cannot work no matter what you configure in the router.

**Good news: the right design never opens a port anyway.**

Ask who actually needs to reach the ERP:

| Who | How | Needs a public IP? |
|---|---|---|
| Staff at their desks | the office LAN | **No** |
| You from home, or a phone in a shop (screen 86) | **Tailscale** | **No** |
| Microsoft 365 — mailbox, SharePoint | the server calls **out** to Graph | **No** |
| The website enquiry form (screen 46) | **it sends an email**, and the ERP already reads the mailbox | **No** |

That last row is the trick worth noticing. Screen 46 looked like it needed a
public web endpoint. It does not — the form on supserv.dz sends an email to the
shared mailbox, and the Inbox picks it up like any other enquiry. **One less thing
exposed to the internet, and one less thing to secure.**

### Tailscale — the whole networking answer

*(Step-by-step setup, the settings that matter, and every free alternative
compared: **`docs/NETWORK.md`**.)*

A private encrypted mesh between your devices. Install it on the server, the
office PCs and the phones, sign in with the Microsoft accounts you already have,
and every device can reach the server at a stable name — **whatever your ISP does
to your IP address, and whether or not you are behind CGNAT.**

- **Free for up to 6 users**, unlimited devices. SUPSERV is two to six people, so
  this fits — and it is also the ceiling. See below.
- **Real HTTPS**, free: Tailscale issues Let's Encrypt certificates for
  `erp.<your-tailnet>.ts.net`. Not a self-signed warning — a real padlock, which
  matters because the app uses secure cookies and the phones need it.
- **No ports opened. No router configuration. No dynamic DNS.** The server dials
  out; nothing dials in.
- On the office LAN, two Tailscale devices connect **directly** over the local
  network, so it is full gigabit speed, not routed through anything.

**Use the same address everywhere** — `https://erp.<tailnet>.ts.net` at a desk, at
home, on a phone. One URL, one certificate, one thing to remember.

**Keep a LAN fallback** for the afternoon the fibre is down and a device needs to
re-authenticate: `http://192.168.1.x:3000` reachable from the office network.
Write the address on a card and put it in the drawer. You will need it once.

**When Tailscale free stops fitting:** the moment you need a seventh user. Two
ways out, both fine — pay $6/user/month, or install **Headscale**, the
open-source Tailscale control server, on the same mini PC and keep it free with
no user limit. Do not do this on day one; know it exists.

### supserv.dz — leave it alone

Cloudflare Tunnel is the other free way to reach a server with no public IP, and
it works well. But on the free plan **it requires moving your whole domain's
nameservers to Cloudflare** — including the MX records that carry your Microsoft
365 email. Breaking company email to publish an internal ERP is a bad trade.

So: **do not touch supserv.dz.** If you ever genuinely need a public endpoint —
a client portal, say — buy a second domain for about €10 a year and put that one
on Cloudflare. Your website and your email never move.

---

## 5. Power

Your plan is right. Two settings and one purchase.

**In the BIOS** (F1 at boot on a ThinkCentre): find **"After Power Loss"** in the
Power menu and set it to **Power On**. The default is "Power Off", which is why
most people's home servers stay dead until somebody notices.

**In Ubuntu**, make sure the services come back on their own — Docker restarts its
containers if they are set to `restart: unless-stopped`, which `docker-compose.yml`
already does.

**The UPS, when you buy it.** A small 650–850 VA unit is plenty — a mini PC draws
15–25 W, so even a cheap one gives you 30+ minutes. Its real job is not to keep
you running through a cut; it is to **stop the abrupt power loss that corrupts a
database mid-write.** Buy one with a USB cable and let it tell the server to shut
down cleanly at 20% battery. That single feature is worth more than the runtime.

Until then, accept the risk knowingly: Postgres is good at surviving sudden power
loss, and the nightly backup is your floor.

---

## 6. What it actually costs

| | One-time | Per year |
|---|---|---|
| 16 GB DDR4 for SUPSERVPC01 | ~€30 | — |
| New desk PC for email and browsing (Win 11 capable) | €150–250 | — |
| External USB SSD for local backups | ~€30 | — |
| UPS 650 VA (later) | €60–90 | — |
| Ubuntu, Docker, Dokploy, Tailscale, Postgres, OCR | 0 | **0** |
| Off-site backup | already in Microsoft 365 | **0** |
| Electricity, ~20 W continuous | — | a few hundred DZD |
| **Total recurring** | | **≈ 0** |

Against €120–180 a year for a VPS, the hardware pays for itself inside the first
year and you own it. Your reasoning was correct.

---

## 7. The plan, in order

**Week 1 — build on what you have.** Docker Desktop on SUPSERVPC01 as it is
today. Get the ERP running on `localhost`. Real work, no real data, nothing
disrupted.

**Week 2 — get the network right before anything depends on it.** Install
Tailscale on the server, both office PCs and your phone — `docs/NETWORK.md` has
the steps. **Disable key expiry on the server** in the admin console; skip it and
the machine goes silent in 180 days. Confirm the ERP opens on your phone over
mobile data. This proves the whole no-public-IP design before you have anything
to lose.

**Week 3 — the swap.** New desk PC takes over email and browsing. SUPSERVPC01
gets 16 GB of RAM and a clean Ubuntu Server 24.04 LTS, wired ethernet, a DHCP
reservation on the router. Then:

```bash
curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up
curl -sSL https://dokploy.com/install.sh | bash
```

Set BIOS "After Power Loss" → **Power On** while the case is open.

**Week 4 — backups, before the first real record.** Nightly Postgres dump →
encrypt → SharePoint, plus a copy to the USB SSD. Then **restore one** into a
scratch database and count the rows. Only after that restore works do you type a
real client into the system.

**Later — the UPS.** And Headscale if you pass six users.

---

## 8. What changes in the rest of the plan

Almost nothing, which is the point of having chosen Docker.

- `docker-compose.yml` is unchanged. It does not know or care what it runs on.
- `STACK.md` §4 — Traefik still terminates TLS, but the certificate now comes from
  Tailscale rather than Let's Encrypt over a public port.
- **Off-site backup moves from an S3 bucket to SharePoint.** One fewer account,
  one fewer bill, and it is a place you already look.
- `.env` — `APP_URL` becomes the `ts.net` name instead of `erp.supserv.dz`.
- **Nothing in `src/` changes at all.**

And if in two years the office is too small for this, the same
`docker-compose.yml` deploys to a rented server in an afternoon. Nothing here is
a one-way door.
