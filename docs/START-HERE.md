# GETTING THE ENVIRONMENT READY

Docker Desktop is installed on SUPSERVPC01. This is what to do next, in order,
with the commands to paste.

**Read section 1 before anything else. There is a problem in your screenshot.**

---

## 1. Disk space — fix this first

Your screenshot says:

> **Local Disk (C:) — 24.0 GB free of 232 GB**

That is not enough, and you will hit it in the middle of a build, which is the
worst moment to discover it. Here is what this project eventually wants:

| | Size |
|---|---|
| Postgres image | ~250 MB |
| Node build layers | ~1.5 GB |
| Playwright image (Chromium + Ubuntu) | **~1.8 GB** |
| OCR image (Tesseract + Arabic + Python) | ~1 GB |
| Docker build cache | 2–5 GB |
| `node_modules` on the Windows side | ~1.5 GB |
| WSL2 virtual disk overhead and growth | 2–4 GB |
| **Realistic total** | **10–15 GB** |

You have 24 GB. It fits on paper and not in practice — Windows itself needs
headroom to page, index and update, and a disk this full slows everything down.

**Get to 60 GB free before you start.** Four ways, best first:

**1 · OneDrive Files On-Demand — the biggest and safest win.**
Your sidebar shows a large OneDrive with many folders. Right-click the folders
you do not open weekly → **Free up space**. The files stay in OneDrive and
download on demand. On a machine like this it commonly recovers 30–80 GB.

**2 · Disk Cleanup, including system files.**
`Win + R` → `cleanmgr` → **Clean up system files**. Look for **"Previous Windows
installation(s)"** — that alone is often 15–25 GB.

**3 · Check the second drive.**
Your screenshot says **Devices and drives (2)** and the second one is cut off. If
it is a real disk with space, move Docker there:
Docker Desktop → **Settings → Resources → Advanced → Disk image location**.

**4 · Uninstall what nobody uses.** Settings → Apps, sort by size.

Check your progress in PowerShell:

```powershell
Get-PSDrive C | Select-Object Used,Free
```

---

## 2. Two Docker Desktop settings

**Memory.** This machine has 8 GB and Windows wants 3 of them. Give Docker a
firm limit so it cannot starve the desktop:

> Docker Desktop → **Settings → Resources** → Memory **4 GB**, CPUs **2**

That is enough for Postgres and comfortable for development. When SUPSERVPC01
becomes an Ubuntu server with 16 GB, this limit disappears — Linux has no VM in
between.

**Start with Windows.** Settings → General → **Start Docker Desktop when you sign
in**. On the eventual Ubuntu server this is handled properly by systemd; on
Windows it needs a signed-in session, which is one of the reasons this machine is
for development and not production.

**Licensing is fine.** Docker Desktop is free for businesses under 250 employees
and under $10M revenue. SUPSERV is well inside that. The "PERSONAL" badge in your
screenshot costs nothing.

---

## 3. Install the three tools

PowerShell, as Administrator, once:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Close PowerShell, open a new one, then:

```powershell
corepack enable
corepack prepare pnpm@10.15.0 --activate
node -v      # expect v24.x
pnpm -v      # expect 10.15.0
git --version
```

---

## 4. Start the database

Open PowerShell in the project folder:

```powershell
cd "$env:OneDrive\SUPSERV ERP"
docker compose -f docker-compose.dev.yml up -d
```

This pulls one small image and starts Postgres. **It builds nothing** — the
Playwright and OCR images are for the Ubuntu server and would eat your remaining
disk.

Check it is alive and that the three extensions installed:

```powershell
docker exec -it supserv-db psql -U supserv -d supserv -c "\dx"
```

You should see **pg_trgm**, **unaccent** and **citext** listed. Those are what
make "Touat Gaz" find "TOUATGAZ" later.

---

## 5. Prove the code runs on your machine

```powershell
pnpm install
pnpm test
```

Expect **10 passing tests**. They are the ones that matter most:

- `0.1 + 0.2` does not cost you a centime on an invoice
- 19% and 9% VAT stay in separate buckets
- a global discount reduces each VAT base proportionally
- droit de timbre is added after VAT
- an option line is excluded from every total
- overdue is computed from the due date, never stored
- a paid invoice cannot go back to draft
- "won" is read from the offer, never stored on the deal

When those pass on SUPSERVPC01, the environment is genuinely ready.

---

## 6. Then hand it to Claude Code

```powershell
git init
git add .
git commit -m "SUPSERV ERP — scaffold, plan, 86 screens"
```

Point Claude Code at this folder. It reads `CLAUDE.md` first and starts Phase 0:
the shell, the avatar menu with the language switch, the table component, the
filter panel, saved views, the empty and error states, `blocking_rule`, and the
day-one wizard.

**Set up a Git remote soon** — GitHub private, or Gitea later on the Ubuntu box.
OneDrive is a backup of files; Git is a history of decisions, and you will want
to undo something in week three.

---

## 7. "If I buy a mini PC or rent a VPS later, is the migration easy?"

**Yes — and it is worth understanding exactly why, so it stays true.**

Everything in this project is one of two things:

| | What it is | On migration |
|---|---|---|
| **State** | the Postgres volume · the files volume · `.env` | **copied** |
| **Everything else** | images, containers, `node_modules`, `.next`, build cache | **rebuilt from the repository** |

That is the whole answer. There are exactly **two** things a new machine needs
that it cannot regenerate: a database dump and a files folder. Nothing is
installed by hand, nothing lives only in someone's memory, and no configuration
was clicked into a control panel.

**The move, on any target — mini PC, VPS, or a rack in ten years:**

```bash
# on the old machine
docker exec supserv-db pg_dump -U supserv supserv | gzip > supserv.sql.gz

# on the new one
git clone <repo> && cd supserv-erp
cp /path/to/.env .env
docker compose up -d
gunzip -c supserv.sql.gz | docker exec -i supserv-db psql -U supserv supserv
```

Four commands. The same `docker-compose.yml` you are using today.

**And you are already rehearsing it.** Going from Windows + Docker Desktop to
Ubuntu + Docker in a few weeks *is* the migration. Do it once on your own
hardware, while there is no real data to lose, and the second time — to a rented
server, if you ever need one — is a Saturday afternoon you have already done.

**Three rules keep it that way.** Claude Code is instructed to follow them:

1. **Nothing is installed on the server by hand.** If a step is not in
   `docker-compose.yml` or a `Dockerfile`, it does not exist. The day someone
   SSHes in and `apt install`s something to fix a problem, the machine becomes
   unique and migration becomes archaeology.
2. **All state is in a named volume.** Never a bind mount to `C:\Users\...`.
3. **All configuration is in `.env`.** Never hardcoded, never clicked into a UI.

---

## 8. So — are you in the right direction?

Yes, on all three counts.

**The hardware.** An i5-6500 with 16 GB is a genuinely capable server for six
people. Adding RAM costs €30 against €150+ for a machine whose CPU you do not
need.

**Docker.** This is precisely why the stack was chosen. The same
`docker-compose.yml` runs on your Windows desktop today, on Ubuntu in three
weeks, and on a rented server in five years. Nothing about the ERP knows or cares.

**Starting on the machine you already own.** You will learn what this system
actually needs — how much RAM OCR really takes, how long a 38-page dossier really
runs — before spending anything. That is a better position than buying hardware
against a guess.

**The one thing to keep honest:** do not put real client data on this machine
while it is Windows 10 and still browsing the web. Build here, test here, and
move to Ubuntu before the first real invoice. `docs/SERVER.md` §3.
