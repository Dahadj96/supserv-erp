# SUPSERV ERP — RULES FOR THIS REPOSITORY

Read this before every task. It is short on purpose.

SARL SUPSERV is a trading and contracting company in Adrar, Algeria. Two to six
people will run the whole company on this system. It replaces paper, Excel files,
OneDrive folders and four mailboxes. The interface was designed first — 86 screens
in Figma — and this repository implements those screens, not an idea of them.

---

## THE SIX LAWS

Break one and the work is wrong even if the tests pass.

**1. Store a state only when a person or an event changes it. Compute it when time
or arithmetic changes it.**
`overdue` is not a column. It is `due_on < today AND balance > 0`. `won` lives on
the offer as `accepted`; the deal reads it. If you find yourself writing a cron
job to keep a status true, you have made this mistake.

**2. Nothing becomes a fact until a person confirms it against the source.**
OCR output, extracted fields, image matches and assistant proposals all stop at a
review step that shows a citation — page number and snippet. Code may not read an
`extraction` row where `confirmed_at IS NULL`.

**3. One document engine. No module renders its own PDF.**
`src/documents/` takes template + record + counterparty + locale + purpose and
returns a PDF, a filed copy, a link, an email draft and an audit entry. Nineteen
document kinds, one code path. A `new PDFDocument()` anywhere else is a bug.

**4. Three language axes. Never merge them.**
- The interface follows the **person** → `user_preference.ui_locale`
- Documents and email follow the **counterparty** → `party.doc_locale`
- Text a human typed keeps the language it was typed in. Never auto-translate it.

An English-speaking employee must produce French paperwork for a French client
without thinking about it.

**5. An issued document is immutable. Correction is a new document.**
Numbers are allocated at issue, never on a draft, never reused. Cancelling writes
an avoir. Enforce this with database triggers, not application code.

**6. The assistant proposes; it never executes, and it cannot delete.**
There is no delete tool, no issue tool and no send tool in its registry. Absence,
not permission. It holds exactly the signed-in user's rights — there is no service
account. Every claim it makes carries a citation.

---

## HARD RULES

- **No hard `DELETE`, in any migration, on any table.** Soft delete with
  `deleted_at` / `deleted_by` / `delete_reason`, a 30-day bin, and an audit entry
  that outlives the record. See `docs/SCREENS.md` → screen 83.
- **Money is never a JavaScript number.** `numeric(16,2)` in Postgres, `Decimal`
  from `decimal.js` in code. One function computes a document total, in
  `src/domain/money.ts`. Never inline a VAT calculation in a component.
- **No legal claim in UI copy.** Anything that sounds like law goes in the
  `blocking_rule` table with an `authority` and a `confirmed_by`. Rules with
  `confirmed_by IS NULL` **warn**; they do not block. The system never asserts a
  law on its own authority.
- **Every disabled control resolves to one or more rule codes.** No grey button
  without a reason. The popover names the rule, its authority, and a fix route.
- **Logical CSS only.** `ms-4`, `pe-2`, `text-start`. Never `ml-4`, `pr-2`,
  `text-left`. Arabic must cost nothing later.
- **Every route lives under `/[locale]/`.** No exceptions.
- **No seed or demo data in the running system.** Fake companies teach people to
  ignore what is on screen. `@faker-js/faker` is for tests only.
- **Try the PDF text layer before reaching for OCR.** It is free, instant, and
  measurably more accurate on digital PDFs. Tesseract runs with `--psm 3`, never
  `--psm 6` — `6` destroys tables and a bordereau des prix is a table. Arabic text
  taken from a PDF text layer must go through bidi + NFKC repair or nobody can
  search it. `docs/OCR.md` has the measurements.
- **Nothing in this system requires a paid service.** It runs on a mini PC in the
  SUPSERV office with no recurring bill — see `docs/SERVER.md`. If a task seems to
  need a cloud subscription, stop and ask.
- **Assume no public IP and no open ports.** The server reaches out (Microsoft
  Graph); nothing reaches in except over Tailscale. Never design a feature that
  needs an inbound webhook — the website form emails the shared mailbox instead.
- **Tailscale is transport, never identity.** Sign-in is Better Auth + Entra ID.
  Never read a Tailscale identity header, and never let a network ACL stand in for
  `src/auth/can.ts`. The address lives only in `.env` — grep for `ts.net` and the
  only hits should be `.env` and docs. `docs/EXIT-PLAN.md` explains why: this is
  what keeps leaving Tailscale a two-hour config change instead of a project.
- **Assume the internet can be down and the office still working.** Anything that
  needs the network — mail, SharePoint filing — is a pg-boss job that retries, not
  something a person waits on.
- **A permission never hides that a thing exists.** Grey the Margin column and
  keep it listed; say "3 rows hidden — offers.margin.view". Search excludes what
  the user may not see, so search never becomes a way around a permission.

---

## WHERE THINGS GO

| If you are writing… | It belongs in |
|---|---|
| A rule about money, VAT, totals | `src/domain/money.ts` |
| A rule about what state may follow what | `src/domain/state.ts` |
| A reason a button is disabled | `src/domain/rules.ts` + `blocking_rule` |
| Anything that produces a PDF | `src/documents/` — nowhere else |
| A permission check | `src/auth/can.ts` — one choke point |
| Reading or writing a file | `src/storage/` behind the `Storage` interface |
| OCR or text extraction | `src/capture/ocr/` behind the provider interface. **Read `docs/OCR.md` first** |
| Anything that runs in the background | `src/jobs/` as a pg-boss job |
| A table, filter, saved view, pagination | `src/components/data/` — **reuse, never rebuild** |
| A toast, dialog, drawer, menu | `src/components/overlays/` |

**Before building any list screen, read `src/components/data/`. It is already
built. Ten screens share it. Do not write a second table.**

---

## HOW TO WORK

1. **Find the screen first.** Every task maps to one or more of the 86 screens.
   `docs/SCREENS.md` lists them with their route and phase. If you cannot find the
   screen, stop and ask — do not invent an interface.
2. **Schema before UI.** Add the Drizzle schema, generate the migration, commit it.
   Never edit a generated migration by hand.
3. **Domain before component.** If the feature has a rule in it, the rule goes in
   `src/domain/` with a unit test, and the component calls it.
4. **Both languages, both files.** A new string means a key in `messages/fr.json`
   **and** `messages/en.json`. A missing French key is a broken build, not a
   warning.
5. **Check your own work.** `pnpm check` runs types, lint, unit tests. For anything
   with a screen, run the Playwright test and look at the screenshot. A layout that
   type-checks can still be unreadable.

---

## WHAT TO DO WHEN UNSURE

- **The screen and this file disagree** → the screen wins. Note it in
  `docs/DECISIONS/`.
- **This file and the plan disagree** → this file wins. It is closer to the code.
- **A library would solve it** → check `STACK.md` first. If it is in the rejected
  list, it was rejected for a reason. If it is genuinely new, add a line to
  `docs/DECISIONS/` saying why, with the date.
- **It needs a paid service** → stop and ask. The whole stack was chosen so that
  SUPSERV can pay for it from Algeria and move it to their own server later.
- **You want to add a status column** → re-read law 1.

---

## THE PHASE YOU ARE IN

Work top to bottom. Do not start a phase before the one above it passes its test.

| ✓ | Phase | Screens | Done when |
|---|---|---|---|
| ✅ | **0 · Shell + interface layer** | 79 80 81 34 35 36 85 | Sign in, switch to Français, see an empty Deals list that explains itself, open the filter panel, save a view, and be told why a disabled button is disabled |
| ✅ | **1 · Records + search** | 21 22 51 73 75 76 82 84 | TOUATGAZ is found by four spellings; two duplicate rows merge without losing a document |
| ✅ | **2 · Capture** | 02 38 39 40 41 46 61 62 86 | A consultation email becomes a deal with a confirmed deadline |
| ✅ | **3 · Document engine** | 70 71 50 47 18 | One offer renders in French for a client and English for a supplier, from one template family |
| ✅ | **4 · Sell side** | 05 06 09 10 11 12 67 74 77 78 | Items pasted from an email body reach a sent offer with a complete annexe technique |
| ✅ | **5 · Money** | 17 72 48 19 20 49 14 | Proforma → invoice → payment → statement, no spreadsheet, and overdue is computed |
| ▶ | **6 · Organisation** | ~~55~~ ~~56~~ ~~57~~ ~~58~~ ~~63~~ ~~65~~ ~~33~~ 59 60 66 ~~83~~ | Two people run the company for a week without opening OneDrive |
| | **7 · Control + assistant** | 27 32 69 45 43 44 28 64 | The assistant answers "what is late and why" with citations, and can change nothing without approval |

**Phase 5 closed 26 August 2026.** Everything that could have been a status
column is computed instead: overdue from the due date and the balance, paid and
partly-paid from payment allocations, delivered from issued bons de livraison,
already-invoiced from issued factures. Orders (screen 13) appear in no phase and
do not exist; deliveries are anchored on the document they cover until they do.

Three things phase 5 refused to assert, all recorded rather than coded around:
the droit de timbre (unconfirmed — warns, never computes), domiciliation on a
foreign-currency receipt (`docs/DECISIONS/2026-08-26-domiciliation.md`), and any
exchange rate at all (no rate has ever been recorded, so currencies are named
beside a total rather than folded into it).

**Phase 6 in progress.** Struck through above is done: 55 Today, 56 Deal
timeline, 57 Conversations, 58 Waiting on, 63 Week ahead, 65 Approvals — and 83
was already built in phase 1. Left: 59 Email templates and
60/66 Files and storage, which wait on real file storage.

Screen 57 shipped without its composer and with two of its four states, because
the ERP holds `Mail.Read` and cannot send
(`docs/DECISIONS/2026-08-27-conversations-are-read-only.md`). The same week also
added a screen the design never drew — `/inbox/[id]`, one message, readable —
because 31 of the first 39 real messages classified `needsReview`, which means
"a person must read this", and there was nowhere to.

The rule those five share is that **nothing on them is a row somebody created**,
with exactly one exception. Today, Waiting on and Week ahead read facts other
screens already hold; the deal timeline reads six such sources. The exception is
`note` — a note or a logged call is the only record of a thing the system never
saw, and a dated one is what a person means by a task. Written once, read by
Today. Anything that looks like it wants a task table is that, or it is a fact
somewhere else already.

---

## THE FIVE TESTS THAT MATTER

Keep these green. They are in `tests/e2e/`.

1. **An email becomes money** — Inbox → deal → item list → three prices from three
   sources → French offer → invoice → payment.
2. **The same screen, two languages** — two users, two interfaces, one French
   document with the right signature block.
3. **A number is never reused** — issue three, cancel the second, issue a fourth.
   The series reads 0001–0004 and 0002 is an avoir. Assert in the database.
4. **The rules hold** — no NIF, no invoice; the popover names décret 05-468 and
   the fix button lands on the right field.
5. **Nothing disappears** — delete, restore at day 20, merge two companies, and
   every document number still resolves.

---

## KEEPING MIGRATION CHEAP

This runs on a mini PC in the office today, on Ubuntu in a few weeks, and
possibly on a rented server one day. Three rules keep that a four-command move:

1. **Nothing is installed on a server by hand.** If a step is not in
   `docker-compose.yml` or a `Dockerfile`, it does not exist. The day somebody
   SSHes in and `apt install`s a fix, the machine becomes unique and migration
   becomes archaeology.
2. **All state lives in a named volume** — the Postgres volume and the files
   volume. Never a bind mount to a user's home directory.
3. **All configuration lives in `.env`.** Never hardcoded, never clicked into a
   control panel.

Everything else — images, containers, `node_modules`, `.next`, build cache — must
be rebuildable from the repository alone.

## COMMANDS

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres only (dev machine)
pnpm dev            # local, both locales
pnpm check          # types + lint + unit. Run before every commit
pnpm test:e2e       # the five journeys
pnpm db:generate    # drizzle-kit generate after a schema change
pnpm db:migrate     # apply
pnpm db:studio      # look at real rows before guessing
```

---

## CONTEXT THAT SAVES YOU TIME

- **Décret 05-468** sets the mandatory mentions on an Algerian invoice: legal name,
  address, **RC, NIF, NIS, article d'imposition**, and the client's NIF. Missing
  any of these is why an invoice is blocked.
- **TVA** is 19 % standard, 9 % reduced, with exonerations that name an article.
  Rates are rows with a start date, never edited in place — last year's invoices
  must still recompute correctly.
- **Facture proforma is not a facture.** It carries no number from the invoice
  series and can never settle anything.
- **Retenue de garantie** and **cautions** appear on public works. Both are on the
  screens; both have unconfirmed compliance rules waiting on the accountant.
- **A tender dossier is evidence.** After deposit it is never deleted, edited or
  reorganised.
- Documents are mostly **French**. Some suppliers are foreign and read **English**.
  Arabic exists in official correspondence and is not yet drawn — but the layout
  must accept it without being redrawn.
