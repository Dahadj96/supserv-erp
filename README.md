# SUPSERV ERP

An ERP for SARL SUPSERV — trading and contracting, Adrar, Algeria.
Two to six people run the whole company on it.

The interface was designed first: **86 screens** in Figma. This repository
implements those screens.

## Read first

| File | What it is |
|---|---|
| **`setup.ps1`** | **Run this first. One command, sets up everything** |
| **`docs/READY.md`** | What the script does, and what to do after |
| `docs/START-HERE.md` | The same steps by hand, if you prefer |
| **`CLAUDE.md`** | The rules. Read before every task |
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

## The six laws, in one line each

1. Store a state only when a person changes it. Compute it when time does.
2. Nothing is a fact until a person confirms it against the source.
3. One document engine. No module renders its own PDF.
4. Interface follows the person; documents follow the counterparty.
5. An issued document is immutable. Correction is a new document.
6. The assistant proposes, never executes, and has no delete tool.

## This folder is inside OneDrive — one thing to do first

The project lives in `OneDrive - supserv\SUPSERV ERP`, which is good: the source
is backed up and versioned without you thinking about it.

But **`node_modules` must not sync.** It is tens of thousands of small files;
OneDrive will churn CPU, slow every build, and occasionally lock a file mid-install
and break it. Once the folder exists, exclude it:

> OneDrive icon → Settings → Account → **Choose folders** → untick
> `SUPSERV ERP/node_modules` (and `.next`)

`.gitignore` already excludes them from Git. This is the separate OneDrive step.

## Getting started

**One command**, PowerShell as Administrator, in this folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

It installs Node, Git and pnpm if missing, writes `.env` with a fresh secret,
starts Postgres, verifies the extensions, installs dependencies, runs the tests,
and makes the first Git commit. Then it prints **ENVIRONMENT IS READY** or
exactly what failed. Safe to run again.

Afterwards, day to day:

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
