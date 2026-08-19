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
| `docs/UI_INDEX.md` | What each screen says and why |
| `docs/SERVER.md` | The office mini PC — hardware, backups, power |
| `docs/NETWORK.md` | How people reach the ERP, and why no public IP is needed |
| `docs/EXIT-PLAN.md` | Leaving Tailscale — the trigger, the four doors, the migration |
| `docs/OCR.md` | How OCR works here, and why it costs nothing |
| `docs/DISK-CLEANUP.md` | Freeing space on the office PC |
| `docs/DECISIONS/` | One file per decision, dated |
| `docs/READY.md` · `docs/START-HERE.md` | Older setup notes. See the status below first |

## Status — read this before believing `CLAUDE.md`

`CLAUDE.md` describes the repository as it is **meant** to be. Today it is a
scaffold. The difference matters when you pick up a task.

**The environment is finished.** Postgres runs, dependencies install, the unit
tests pass, the repository is on GitHub.

**The application is not started.** `pnpm dev` will not run yet — there is no
Next.js app to serve.

| Exists | Does not exist yet |
|---|---|
| `src/domain/` — money, state, rules, numbering | `src/app/` — no routes at all |
| `src/db/schema/` — four tables | `next.config.ts`, Tailwind setup, next-intl middleware |
| `src/i18n/messages/{fr,en}.json` | `src/components/` — including `components/data/` |
| `src/auth/can.ts`, `src/storage/`, `src/capture/ocr/` | `src/documents/`, `src/jobs/` |
| `tests/unit/` — 10 passing | `drizzle/` migrations, `tests/e2e/` |

So: **Phase 0 has not been built.** When `CLAUDE.md` says "reuse, never rebuild"
and points at `src/components/data/`, that component does not exist yet — it is
the thing Phase 0 has to produce, once, before ten screens share it.

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
