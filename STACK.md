# SUPSERV ERP — THE TOOLCHAIN

**Decided: self-hosted on a mini PC in the SUPSERV office, managed by Dokploy.**
*(Updated 19 Aug 2026 — the VPS is replaced by office hardware. See `docs/SERVER.md`.)*
Written for Claude Code as the implementer. August 2026. All versions checked
against npm on 19 Aug 2026.

Two answers shaped everything below:

- **Claude Code writes the code.** So the repository must be legible to an agent:
  one obvious place for each thing, rules written down rather than implied, and a
  way to check its own work. `CLAUDE.md` matters as much as `package.json`.
- **A mini PC in the office + Dokploy.** No managed SaaS you cannot leave, and now
  no rented box either. Every piece runs on one small Linux machine in Adrar, with
  the same `docker-compose.yml` that would deploy to any rented server if that ever
  changes.

That second choice costs you a little convenience and buys you the thing you asked
for: **you are never locked in, and you can always pay for it.**

---

## 1. THE SHORT LIST

Three purchases, all one-time. **Nothing recurring.**

| What | Why | Cost |
|---|---|---|
| **A dedicated mini PC** — 16 GB RAM, 500 GB NVMe, Intel 8th gen or newer | The server. Ubuntu Server 24.04 LTS, wired ethernet | **€150–250 once** |
| **An external USB SSD** | The local nightly backup | ~€30 once |
| **A UPS, 650–850 VA** *(later)* | Not for uptime — to stop a power cut corrupting Postgres mid-write | €60–90 once |
| Ubuntu · Docker · Dokploy · Postgres · Tailscale · OCR · Git | The entire software stack | **0** |
| **Microsoft 365** — already paid | Mailbox, SharePoint filing, Entra ID sign-in, **and the off-site backup target** | already paid |
| Your 1 Gbps office fibre | Already there, 24/7 | already paid |

**Recurring cost: effectively zero** — a few hundred dinars of electricity for a
machine drawing about 20 W. Against €120–180/year for a VPS, the hardware pays for
itself inside the first year and you own it afterwards.

**No public IP is needed and none is used.** Access is over Tailscale — free for
up to six users, real HTTPS, no ports opened, works behind CGNAT. `supserv.dz` is
not touched. Full reasoning in `docs/SERVER.md`.

**The one thing this buys you that a VPS cannot:** when the fibre drops, the
office keeps working. Everyone is on the same switch as the server.

**The one thing it costs you: backups are now your job.** `docs/SERVER.md` §2.

## 2. THE STACK

### Runtime and framework

| Package | Version | Note |
|---|---|---|
| **Node.js** | 24 LTS | The Docker base image |
| **Next.js** | `16.3.1` | App Router, server actions, standalone output for Docker |
| **React** | `19.2.8` | |
| **TypeScript** | `7.0.2` | The native compiler — very fast. **Fallback: pin `5.9.x` if any dependency fails to type-check.** Decide this in the first hour, not the third month |

### Database and data access

| Package | Version | Note |
|---|---|---|
| **PostgreSQL** | 18 | A Dokploy database service. Extensions: `pg_trgm`, `unaccent`, `citext` |
| **drizzle-orm** | `0.45.2` | **Not** the 1.0 beta. Migrations you can read in a pull request |
| **drizzle-kit** | `0.31.10` | |
| **drizzle-zod** | `0.8.3` | Schema → validation, one source of truth |
| **postgres** | `3.4.9` | The driver. Lighter than `pg`, works with Drizzle |
| **decimal.js** | `10.6.0` | **Money is never a JavaScript float.** `numeric(16,2)` in Postgres, `Decimal` in code, integer centimes on the wire |

> **On row-level security.** Supabase is not in this stack, so there is no RLS
> convenience layer. With six users, application-layer authorisation through a
> single `can()` choke point is correct, testable, and something an agent gets
> right. Postgres RLS is added later as defence in depth on `document`,
> `payment` and `person` — not on day one.

### Authentication

| Package | Version | Note |
|---|---|---|
| **better-auth** | `1.7.1` | Self-hosted, Drizzle adapter, sessions in your own Postgres |
| **@node-rs/argon2** | `2.1.0` | Password hashing |

Two ways in, both real:

1. **Microsoft Entra ID** — you already have the accounts. Confirmed supported.
   Use `profile.oid` as the identity anchor, **not** email: Microsoft does not
   emit an `email` claim for managed users by default, and this trips up nearly
   everyone.
2. **Email + password** for anyone without an M365 licence — a site foreman,
   a temporary user.

### Interface

| Package | Version | Used by |
|---|---|---|
| **tailwindcss** | `4.3.3` | Everything. **Logical properties only** — `ms-4`, never `ml-4` |
| **radix-ui** | `1.6.7` | Menus, dialogs, popovers, tooltips — screens 36, 80 |
| **lucide-react** | `1.33.0` | The icons already drawn in Figma |
| **@tanstack/react-table** | `9.1.2` | The **one** table component — screens 79, 35 |
| **nuqs** | `2.9.6` | Filters live in the URL. This is screen 79's rule, and this library is exactly that rule |
| **cmdk** | `1.1.1` | ⌘K palette — screen 36 |
| **sonner** | `2.0.8` | Toasts — screen 36 |
| **@dnd-kit/core** | `6.3.1` | Column reorder, line reorder in the document builder |
| **react-hook-form** | `7.85.0` | Forms |
| **@hookform/resolvers** | `5.9.1` | + Zod |
| **zod** | `4.4.3` | Every input boundary |
| **@tanstack/react-query** | `5.101.4` | Client cache where server components are not enough |
| **recharts** | `3.10.1` | Screens 03, 04, 28 only |

### Language

| Package | Version | Note |
|---|---|---|
| **next-intl** | `4.13.7` | ICU messages, `fr` and `en` from day one, `ar` structurally possible |

Three separate things, never merged into one setting:
`user.ui_locale` → the interface · `party.doc_locale` → documents and email ·
stored text keeps the language it was typed in.

### Documents

| Package | Version | Note |
|---|---|---|
| **playwright** | `1.62.1` | HTML template → PDF. **Runs in its own container**, not inside the Next.js image |
| **@playwright/test** | `1.62.1` | Also the end-to-end test runner |
| **pdf-lib** | `1.17.1` | Merge the annexe technique onto an offer, stamp page numbers |
| **unpdf** | `1.8.1` | **Read the text layer of a PDF before reaching for OCR.** Most tender files are digital. This one line saves most of your OCR bill |

### Capture

| Package | Version | Note |
|---|---|---|
| **@microsoft/microsoft-graph-client** | `3.0.7` | Shared mailbox → Inbox, drafts back out, SharePoint filing |
| **exceljs** | `4.4.0` | Screens 62, 73. Use this, not `xlsx` — the npm `xlsx` package is stale at 0.18.5 |
| **papaparse** | `5.6.0` | CSV |
| **@azure-rest/ai-document-intelligence** | `1.1.0` | OCR — see §3 |
| **sharp** | `0.35.3` | Phone photos are 4 MB. Resize before storing — screens 61, 77, 86 |

### Background work

| Package | Version | Note |
|---|---|---|
| **pg-boss** | `12.27.0` | Job queue **inside your existing Postgres.** No Redis, no extra container, no SaaS. Mail polling, OCR, PDF generation, nightly digests |

This is the single best fit for a self-hosted ERP at your size. Inngest and
Trigger.dev are better products and both pull you back into a monthly bill abroad.

### Quality

| Package | Version | Note |
|---|---|---|
| **vitest** | `4.1.11` | Unit — money maths, VAT, numbering, state transitions |
| **@playwright/test** | `1.62.1` | End-to-end — the five journeys in §6 |
| **@biomejs/biome** | `2.5.9` | Lint + format in one, fast. Replaces ESLint + Prettier |
| **pino** | `10.3.1` | Structured logs |
| **@t3-oss/env-nextjs** | `0.13.11` | The app refuses to boot with a missing env var, instead of failing at 16:00 on a Thursday |
| **@faker-js/faker** | `10.6.0` | **Tests only.** Screen 85: no seed data in the running system, ever |

---

## 3. THE THREE DECISIONS THAT ARE ACTUALLY HARD

### 3.1 OCR — free, on your own server. Measured, not assumed.

**Azure is out of the plan.** You pay for the VPS and nothing else. Full working
in `docs/OCR.md`; the summary:

**Microsoft 365's own OCR does not qualify.** SharePoint and OneDrive do OCR
images and PDFs, and it would have been ideal — but it needs a **Syntex licence or
pay-as-you-go Azure billing**, which is exactly the second bill you are avoiding.
And for PDFs the text is only indexed for search, never exposed in a column you
could read back. Checked and rejected.

**The finding that removes the problem: most tender PDFs are digital, and a
digital PDF needs no OCR at all.** Measured on a five-line bordereau des prix:

| Path | Time | Result |
|---|---|---|
| `pdfplumber`, text layer | **0.055 s** | **every row, column and price correct**, including `2×1,5 mm²` |
| Tesseract at 300 dpi | 2.69 s | prices right, but `mm²` → `mm?`, `TTC` → `TIC` |

Fifty times faster and *more* accurate. So the free path is the primary route, not
the fallback. OCR is only for paper you actually scanned.

**The stack, three CPU-only tools in one container:**

| Stage | Tool | Version | Job |
|---|---|---|---|
| 1 · text layer | **pdfplumber** | `0.11.10` | text **and tables** from digital PDFs |
| 2 · OCR | **OCRmyPDF** + Tesseract 5 | `17.10.0` | scans. Writes a text layer back, so stage 1 works ever after |
| 3 · hard pages | **RapidOCR** (ONNX PaddleOCR) | `1.4.4` | better accuracy, ~5 s/page, still no GPU |

**One setting decides whether bordereaux work: `--psm 3`, never `--psm 6`.**
Measured on the same table — `--psm 6` lost row 4 entirely and read the header as
`Prcuniaire#T | Momtanenr`; `--psm 3` got all five rows correct. Every tutorial
online uses `--psm 6`.

**Arabic inverts the rule, and this one is not obvious.** Tesseract reads printed
Arabic well (3 of 4 lines perfect on a real tender notice), but the *text layer*
of an Arabic PDF comes out as reversed presentation glyphs that nobody can search.
`python-bidi` + `NFKC` repairs it — tested, and `"الجزائرية" in text` becomes true.
So: trust the text layer for French, repair or bypass it for Arabic.

**Cost: 0 DZD. ~500 MB RAM in a queued job. No client document leaves your
server** — which for a tender dossier matters more than the money.

**What you give up:** handwriting (your tenders are printed), cell-perfect
structure on *scanned* tables (screen 40 already puts a person on that), and
per-field confidence (LAW 2 already requires confirmation). Every gap lands on a
screen that already exists.

The `azure.ts` slot stays empty in the provider interface. If a scanned bordereau
ever costs you an hour a week, it is one file and an API key — not a migration.

### 3.2 Files — two places, on purpose

Screen 66 settled this and the VPS does not change it.

| What | Where | Why |
|---|---|---|
| Issued documents, dossiers, anything a human reads | **SharePoint**, via Graph | You already pay for it, it is already backed up, and somebody can open File Explorer in three years and find the folder without the ERP running |
| Uploads, scans, phone photos, generated intermediates | **A Docker volume on the VPS**, behind a `Storage` interface | Simplest thing that works. Regenerable or re-uploadable |
| Database backups | **An off-site S3 bucket**, nightly, via Dokploy | Non-negotiable |

**Do not install MinIO.** It was the obvious answer for years and is now archived.
If you later want an S3 API on the box, **Garage** is the current lightweight
choice — but you will not need it for a long time. Keep the `Storage` interface
and swap one file if you do.

### 3.3 Search — Postgres, not a search engine

Screen 82 wants search across records, generated documents, received files
(including OCR'd text) and email bodies. That reads like a job for Meilisearch or
Typesense. It is not, at your size.

```sql
create extension if not exists pg_trgm;    -- fuzzy: "Touat Gaz" ~ "TOUATGAZ"
create extension if not exists unaccent;   -- "société" = "societe"

-- one searchable text row per thing, whatever it came from
create table search_document (
  id uuid primary key,
  entity text not null, entity_id uuid not null,
  title text, body text,
  locale text,
  visible_to_permission text,              -- margin/cost/salary excluded per user
  tsv tsvector generated always as (
    to_tsvector('french', unaccent(coalesce(title,'') || ' ' || coalesce(body,'')))
  ) stored
);
create index on search_document using gin(tsv);
create index on party_alias using gin (alias gin_trgm_ops);
```

One database, one backup, no second service to run and keep in sync. Revisit only
if a search takes longer than a second on real data.

---

## 4. HOW IT RUNS

Six containers on one mini PC in the office, all managed by Dokploy from one
`docker-compose.yml`. The file does not know what it runs on.

```
                     ┌──────────── Traefik (Dokploy) ────────────┐
                     │ erp.<tailnet>.ts.net  ·  real HTTPS, free │
                     │ no public IP · no open ports · via Tailscale│
                     └──────────────────┬────────────────────────┘
                                        │
   ┌────────────┐   ┌──────────────────▼─────────┐   ┌──────────────┐
   │ postgres   │◄──┤  web    Next.js 16          │──►│ renderer     │
   │ 18         │   │  + pg-boss worker           │   │ Playwright   │
   │ + pg_trgm  │   └──────────────┬──────────────┘   │ HTML → PDF   │
   └─────┬──────┘                  │                  └──────────────┘
         │                  ┌──────▼───────┐
   nightly backup           │ files volume │          ┌──────────────┐
         │                  └──────────────┘          │ Microsoft    │
   ┌─────▼──────────────┐                             │ Graph        │
   │ USB SSD (local)    │                             │ mail + files │
   │ SharePoint (off-   │◄─── encrypted, nightly ─────│ outbound only│
   │ site, already paid)│                             └──────────────┘
   └────────────────────┘
```

**Why the renderer is separate:** Playwright drags Chromium and its libraries into
the image. Keeping it out of the web container means your app image stays around
200 MB instead of 1.5 GB, and deploys take one minute rather than eight. It also
means a PDF render that hangs cannot take the application down with it.

**Dokploy gives you, without you configuring any of it:** deploy on `git push`,
Traefik routing, free auto-renewing certificates, a Postgres service with
scheduled backups to S3, CPU/memory/disk graphs per container, rollback to the
previous deploy, and environment variables held outside the repository.

---

## 5. THE REPOSITORY

One place for each thing. This layout exists so an agent never has to guess.

```
supserv-erp/
├─ CLAUDE.md                 ← the rules. Read before every task
├─ docs/
│   ├─ PLAN.md               ← the v4 build plan
│   ├─ SCREENS.md            ← 86 screens → routes → phase
│   └─ DECISIONS/            ← one file per decision, dated, with the reason
├─ src/
│  ├─ app/[locale]/          ← every route is under a locale. No exceptions
│  │   ├─ (auth)/            ← login
│  │   └─ (app)/             ← the shell: sidebar, topbar, avatar menu
│  ├─ components/
│  │   ├─ ui/                ← button, input, tag, panel — screen 35
│  │   ├─ data/              ← THE table, filter panel, saved views — screen 79
│  │   └─ overlays/          ← toast, confirm, drawer, palette — screen 36
│  ├─ db/
│  │   ├─ schema/            ← one file per group: party, item, document…
│  │   └─ migrations/        ← generated, committed, never edited by hand
│  ├─ domain/                ← the laws live here, not in components
│  │   ├─ money.ts           ← Decimal only. One place that computes a total
│  │   ├─ numbering.ts       ← allocate on issue, never reuse
│  │   ├─ state.ts           ← the state machines from screen 64
│  │   └─ rules.ts           ← blocking_rule: why a button is disabled
│  ├─ auth/                  ← better-auth + can()
│  ├─ documents/             ← THE engine. Screen 70. Nothing else makes a PDF
│  ├─ capture/               ← mail, upload, ocr/, extraction review
│  ├─ storage/               ← Storage interface + local + sharepoint
│  ├─ jobs/                  ← pg-boss definitions
│  └─ i18n/  messages/fr.json  messages/en.json
├─ tests/
│  ├─ unit/                  ← money, VAT, numbering, transitions
│  └─ e2e/                   ← the five journeys
├─ docker-compose.yml
├─ Dockerfile                ← web
└─ Dockerfile.renderer       ← playwright
```

---

## 6. THE FIVE TESTS THAT DECIDE WHETHER IT WORKS

Not unit-test coverage. Five journeys. If these pass, the system is real.

1. **An email becomes money.** A TouatGaz consultation lands in the Inbox → deal →
   item list → three prices from three different sources → offer in French →
   invoice → payment. No spreadsheet touched.
2. **The same screen, two languages.** A. Dahadj in English and K. Meziane in
   Français see the same deal, and both produce a French document for the client
   with the correct signature block.
3. **A number is never reused.** Issue three invoices, cancel the second, issue a
   fourth. The series reads 0001, 0002, 0003, 0004 and 0002 is an avoir. Assert
   this in the database, not the interface.
4. **The rules hold.** Issuing an invoice for a client with no NIF is blocked, the
   popover names décret 05-468, and the fix button goes to the right field.
5. **Nothing disappears.** Delete a contact, restore it 20 days later, merge two
   companies, and confirm every document number still resolves.

---

## 7. WHAT WAS REJECTED, AND WHY

Written down so it is not re-argued in three months.

| Rejected | Reason |
|---|---|
| **A rented VPS** | A used mini PC costs less than one year of any VPS, Algerian or foreign — and keeps serving the office when the fibre drops |
| **Supabase (managed)** | Excellent, and it is a monthly foreign card payment plus a vendor you cannot leave easily. Plain Postgres on your own box loses very little |
| **Vercel** | Same. Dokploy on your own hardware does what you need for nothing |
| **Cloudflare Tunnel** | Free and good, but on the free plan it requires moving supserv.dz's nameservers — including the Microsoft 365 MX records. Not worth risking company email |
| **Dynamic DNS + port forwarding** | Fragile, and useless if the ISP uses CGNAT. Tailscale sidesteps the question entirely |
| **Running production on the existing office PC** | It browses the web and reads email. Ransomware there would find the ERP database on the same disk |
| **MinIO** | Archived. Was the right answer for years; is not now |
| **Meilisearch / Typesense** | A second service to run, back up and keep in sync, for a search Postgres handles at this size |
| **Redis** | Nothing here needs it. pg-boss uses the database you already have |
| **Inngest / Trigger.dev** | Better products, both bring back a foreign monthly bill |
| **Drizzle 1.0** | Still beta. Ship on `0.45.2` |
| **A separate mobile app** | Screen 86 is four screens. They are responsive web. An app store account is a recurring cost and a release process you do not want |
| **Microservices** | Two people run this company. One application, five containers |
| **Seed / demo data** | Screen 85. A system with fake companies in it teaches people to ignore what is on screen |

---

## 8. THE ORDER OF THE FIRST FOUR WEEKS

**Week 1 — build on the PC you already have.** Docker Desktop on the current
ThinkCentre. Scaffold Next.js 16 + TypeScript + Tailwind 4 + Drizzle + next-intl.
Get `/fr` and `/en` rendering. Real work, **no real client data.**

**Week 2 — prove the network before anything depends on it.** Tailscale on the
server, both office PCs and your phone. Open the ERP on your phone over mobile
data. Once that works, the whole no-public-IP design is proven and you never think
about your IP address again.

**Week 3 — the dedicated mini PC.** Ubuntu Server 24.04 LTS, wired ethernet, a
DHCP reservation on the router, BIOS **"After Power Loss" → Power On** while the
case is open. Then two commands:

```bash
curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up
curl -sSL https://dokploy.com/install.sh | bash
```

Deploy on `git push`. **Do not write a feature until deployment is boring.**

**Week 4 — backups, before the first real record exists.** Nightly Postgres dump →
encrypt → SharePoint, plus a copy to the USB SSD. Then **restore one into a
scratch database and count the rows.** Only after that restore works does a real
client get typed into the system.

**Then phase 0 proper** — the shell, the avatar menu with the language switch, the
table component, the filter panel, saved views, empty/loading/error states,
`blocking_rule`, and the day-one wizard. Screens 79, 80, 81, 34, 35, 36, 85.

**End of that stretch you should be able to:** sign in with your Microsoft account
from your phone in a shop, switch to Français, land on an empty Deals list that
explains what belongs there, save a view, and be told exactly why a disabled
button is disabled — on a machine sitting in your own office, costing nothing a
month.

## 9. ONE THING TO SETTLE FIRST

**Which design is authoritative.** The three pasted architecture reviews referenced
`ENQ-2026-0041`, `SR-2026-0018`, `OFF-2026-0031`, and suppliers Cortel and BR
Système. A search of all 86 screens confirms **none of them exist in this file.**

Two designs are in circulation. Point Claude Code at the wrong one and it will
build the wrong thing very efficiently. Settle it before day one.
