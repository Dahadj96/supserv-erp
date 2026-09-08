# SUPSERV ERP

An ERP for SARL SUPSERV — trading and contracting, Adrar, Algeria.
Two to six people run the whole company on it.

The interface was designed first: **86 screens** in Figma. This repository
implements those screens.

## Where things are

| | |
|---|---|
| Working copy | `C:\SUPSERV-ERP` on **SUPSERVPC01** (Windows 10, i5-6500, 8 GB) |
| Git remote | `https://github.com/Dahadj96/supserv-erp` — private |
| Figma | [`v4 - Complete`](https://www.figma.com/design/p0zcsZTobPL8zZAeYhyYBt) — 86 screens plus a `_Shell` master |

The repository is the only source of truth. It is not inside OneDrive and must
not be moved there: `node_modules` is tens of thousands of small files and
OneDrive will churn CPU, slow every build, and occasionally lock a file
mid-install. Back up by pushing to GitHub, not by syncing the folder.

## Read first

| File | What it is |
|---|---|
| **`CLAUDE.md`** | **The rules. Read before every task** |
| `STACK.md` | Every tool and library, with the reason and the version |
| `docs/PLAN.md` | The build plan — data model, phases, what is still open |
| `docs/SCREENS.md` | 86 screens → routes → phase |
| **`docs/ACCEPTANCE.md`** | **Is the plan finished? Each phase's "Done when", the tests that prove it, and what is not proved** |
| `docs/RUNBOOK.md` | The server as it actually is — what is done, what is not, and the commands |
| `docs/UI_INDEX.md` | What each screen says and why |
| `docs/SERVER.md` | The office mini PC — hardware, backups, power |
| `docs/NETWORK.md` | How people reach the ERP, and why no public IP is needed |
| `docs/EXIT-PLAN.md` | Leaving Tailscale — the trigger, the four doors, the migration |
| `docs/OCR.md` | How OCR works here, and why it costs nothing |
| `docs/DISK-CLEANUP.md` | Freeing space on the office PC |
| `docs/DECISIONS/` | One file per decision, dated |
| `docs/READY.md` · `docs/START-HERE.md` | Older setup notes. See the status below first |

## Current status

**Last verified: 2026-09-08 · 123 test files and 1,608 tests passing.**

See `CLAUDE.md` and `docs/ACCEPTANCE.md` for the current implementation and
acceptance status. The phase notes below are retained as the historical snapshot
from 2026-08-22; their counts and “not started” statements are no longer current.

## Historical status — 2026-08-22

`CLAUDE.md` describes the repository as it is **meant** to be. This section says
where it actually is, and is updated at the end of every phase.

**Last updated: 2026-08-22 · ~33 of 83 screens have a working route · 272 tests passing.**

`pnpm dev` runs. Sign in with Microsoft, switch to Français, and the records
half of the system works end to end. Since 2026-08-22 an invoice does too:
`/setup` → `/documents/new` → the document, its checklist and its PDF.

**Phases 0, 1 and 3 are done. Phase 2 is not** — the scan station (41), the
website forms (46), quick capture (61) and the phone screens (86) have no route,
and the mailbox is not reading (see below). Of phase 0 only screen 31, Modules,
is still missing, and it is a switchboard for modules that do not exist yet.

**Day one has not been filled in yet.** `company_identity`, `vat_rate`,
`numbering_series` and `bank_account` are all empty, so `/documents/new` will
let you draft an invoice and `/documents/[id]` will refuse to issue it, naming
what is missing. That refusal is the system working, not a bug.

**Phase 1:**

| Built | Screens |
|---|---|
| Shell, auth, roles, the shared table, filters, saved views, states | 79 80 81 34 35 36 |
| Companies — list, create, edit, aliases | 21 22 |
| Deletion — discard, archive, restore, the 30-day bin | 83 |
| Merge duplicates — suggestions, field by field, what moves across | 84 |
| Contacts — facets, quality, the bouncing banner | 76 |
| People — four origins, two required fields | 51 |
| Search — companies, people, contacts, items, each saying why it matched | 82 |
| Designation rules and item alias memory *(domain only — see below)* | 73 75 |

**Phase 2, so far:**

| Built | Screens |
|---|---|
| Intake channels, the routing rules, the safety rails | 38 |
| The Inbox — deadline first, nothing expires unread | 02 |
| The Excel move-in — read, preview, import, undo within 7 days | 62 |
| Reading a PDF from its text layer, and reviewing what was read | 39 40 |

**The mailbox is not reading yet, on purpose.** Application `Mail.Read` reaches
every mailbox in the tenant until Exchange RBAC for Applications scopes it to
one, so `src/capture/mail/graph.ts` refuses to make a request until
`MS_MAILBOX_SCOPE_CONFIRMED=true`. **`docs/MAILBOX-ACCESS.md`** is the
procedure and `scripts/scope-mailbox.ps1` runs it.

**Two screens ship as domain, not as screens.** 73 and 75 live inside a deal,
and deals are phase 4. The rules and the alias memory are built and tested; the
pages arrive with the offer builder. `docs/DECISIONS/2026-08-21-designation-before-the-offer-builder.md`.

**Phase 3 — done:**

| Built | Screens |
|---|---|
| Day one — eleven steps, every one computed, four of them blocking | 85 |
| The document engine — seven steps, one renderer, one numbering | 70 |
| Document templates, versioned, and a reprint that reproduces the original | 71 |
| Document types — eighteen kinds and what each one is worth | 50 |
| The builder — lots, options, subtotals, free text, page breaks | 47 |
| New document, typed *(the "start from an order" paths await phase 5)* | 72 |
| The document, its checklist, its PDF and the Issue button | 18 |
| Invoices — list, filters, an age computed rather than stored | 17 |

**Also built, out of order because everything pointed at it:** the compliance
profile (69), where a person confirms a rule and it starts refusing; users and
roles (30); settings (29); language (53).

**Four compliance rules still warn instead of blocking**, because nobody has
confirmed them: the droit de timbre threshold, the retenue de garantie
treatment, TVA on services rendered abroad, and how long a proforma stays valid.
They are written down, they appear on every document that touches them, and the
day somebody signs off on one it starts refusing. `/settings/compliance` is
where that happens, and the one-pager to send your accountant is on it.

**Not started: the rest of phase 2, and phases 4 onward** — the scan station,
the website forms, the phone screens, the whole sell side (enquiry → item list →
prices → offer → technical annex), payments and ageing, and the assistant.

**Nothing is seeded.** The database holds whatever you have typed into it. A
screen with no rows is telling you the truth.

## The six laws, in one line each

1. Store a state only when a person changes it. Compute it when time does.
2. Nothing is a fact until a person confirms it against the source.
3. One document engine. No module renders its own PDF.
4. Interface follows the person; documents follow the counterparty.
5. An issued document is immutable. Correction is a new document.
6. The assistant proposes, never executes, and has no delete tool.

## Setting up a machine

`setup.ps1` still exists but has not been re-run since the environment was
built by hand. **Its `corepack enable` step fails with EPERM without
Administrator.** Install pnpm this way instead — it lands in `%AppData%\npm`
and needs no elevation:

```powershell
npm install -g pnpm@10.15.0
```

The rest, in order, from this folder:

```powershell
# 1. WSL limits — Docker runs its engine inside WSL 2 and will otherwise
#    take half the RAM and every core. Write %UserProfile%\.wslconfig:
#      [wsl2]          memory=4GB / processors=2 / swap=2GB
#      [experimental]  autoMemoryReclaim=gradual / sparseVhd=true
#    then: wsl --shutdown
# 2. Start Docker Desktop and wait for the engine.
docker compose -f docker-compose.dev.yml up -d
pnpm install
pnpm test                                          # expect 10 passing
```

Check the database came up with its extensions — `pg_trgm`, `unaccent` and
`citext` are created by `docker/init-extensions.sql` on first boot only:

```powershell
docker exec supserv-db psql -U supserv -d supserv -c "\dx"
```

**Postgres 18 note.** The named volume is mounted at `/var/lib/postgresql`, not
`/var/lib/postgresql/data`. Postgres 18 keeps its data in a version-specific
subdirectory and refuses to start on the old path. Do not "fix" it back.

## Day to day

```powershell
docker compose -f docker-compose.dev.yml up -d     # database
pnpm dev                                           # http://localhost:3000/fr
pnpm check                                         # types + lint + tests
```

`pnpm check` before every commit — types, lint, unit tests.

**Two compose files, on purpose.** `docker-compose.dev.yml` is Postgres alone for
the Windows machine. `docker-compose.yml` is the full six-container stack for the
Ubuntu server — do not build it on a laptop, Playwright and OCR are ~3 GB.

## Deploying

Dokploy on a mini PC in the Adrar office — see `docs/SERVER.md`.
`docker-compose.yml` is the whole topology and does not care what it runs on.
Because the repository is on GitHub, moving to a different mini PC or a VPS is
`git clone`, drop in `.env`, `docker compose up` — nothing is configured by hand
on a server.

Reached over **Tailscale** at `https://erp.<tailnet>.ts.net` — no public IP, no
open ports, real HTTPS. LAN fallback `http://<server-ip>:3000` for the afternoon
the fibre is down.

**Set up the nightly backup to SharePoint and restore one, before the first real
client record exists.** On an office server nobody else is doing this for you.

## The five tests that decide whether it works

1. An email becomes money — Inbox → deal → prices → offer → invoice → payment.
2. The same screen, two languages, one correct French document.
3. A number is never reused — issue three, cancel one, issue a fourth.
4. The rules hold — no NIF, no invoice, and the popover says why.
5. Nothing disappears — delete, restore, merge, and every number still resolves.

They live in `tests/e2e/`, which does not exist yet. Phase 0 first.
