# ONE COMMAND, THEN BUILD

Everything below is done by `setup.ps1`. You do not need to read this unless
something fails.

---

## Run it

PowerShell **as Administrator**, in the project folder:

```powershell
cd "$env:OneDrive\SUPSERV ERP"
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

It is safe to run again. Every step checks before it acts, and it will not
overwrite a `.env` you already have.

---

## What it does, in order

| | Step | Why |
|---|---|---|
| 1 | Checks free space on C: | Below 25 GB it stops rather than fail mid-build |
| 2 | Writes **`.wslconfig`** — 4 GB, 2 CPUs, 2 GB swap | Docker Desktop has no sliders on the WSL 2 backend; Windows owns the limits |
| 3 | Checks Docker is running | Stops early with a clear message if not |
| 4 | Installs **Node LTS**, **Git**, **pnpm** if missing | via winget, silently |
| 5 | Creates `.env` with a **fresh random auth secret** | and points the database at `localhost`, not the container name — the usual first mistake |
| 6 | Starts **Postgres** and waits for it | then checks `pg_trgm`, `unaccent`, `citext` actually installed |
| 7 | `pnpm install`, then runs the tests | **10 passing** proves the money and state logic works on this machine |
| 8 | `git init` and the first commit | so Claude Code has history from line one |

Then it prints **ENVIRONMENT IS READY**, or a list of exactly what failed.

---

## About the memory limit — there are no sliders

Docker Desktop on this machine uses the **WSL 2 backend**, and its Resources
screen says so directly:

> *"You are using the WSL 2 backend, so resource limits are managed by Windows."*

So there is nothing to drag. Windows owns those limits and they live in a file:
`%UserProfile%\.wslconfig`. **The script writes it for you** — 4 GB of memory,
2 CPUs, 2 GB of swap, on a machine with 8 GB where Windows wants three of them.

Because WSL must restart to pick the file up, the script stops after writing it
and tells you to quit Docker Desktop, run `wsl --shutdown`, start Docker again,
and run the script once more. It then carries on from where it left off.

It also sets two things worth having:

- `autoMemoryReclaim=gradual` — WSL gives memory back to Windows instead of
  holding everything it ever touched.
- `sparseVhd=true` — new Docker disks shrink when you delete images, rather than
  growing to 30 GB and staying there. On a machine where you just spent an
  evening freeing space, this matters.

**One setting you still do by hand:** Docker Desktop → **Settings → General** →
tick **Start Docker Desktop when you sign in**. The server has to come back by
itself after a power cut.

---

## After it says READY

Open Claude Code in this folder and give it this:

> Read `CLAUDE.md` and `docs/SCREENS.md`, then start Phase 0.
> Scaffold the Next.js 16 app with next-intl (fr + en), Tailwind 4, Drizzle and
> better-auth. Build the shell first — sidebar, topbar, and the avatar menu with
> the working language switch. Screens 80 and 81.

It reads the rules, the screen list and the six laws before it writes anything.

**Build order after that**, from `CLAUDE.md`:
the table component and filter panel (79) → empty, loading and error states (34)
→ component states (35) → overlays (36) → `blocking_rule` → the day-one wizard
(85). That is Phase 0 finished, and every screen after it gets faster.

---

## Daily commands

```powershell
docker compose -f docker-compose.dev.yml up -d     # start the database
docker compose -f docker-compose.dev.yml stop      # stop it
pnpm dev                                           # the app, localhost:3000/fr
pnpm check                                         # types + lint + tests
docker exec -it supserv-db psql -U supserv supserv # look at real rows
```

---

## If something fails

**"Docker is not running"** — start Docker Desktop, wait for the whale icon to
stop animating, run the script again.

**"Node install failed"** — winget put it on the PATH but this window does not
know yet. Close PowerShell, open a new one, run the script again.

**"Extensions missing"** — the database was created before
`docker/init-extensions.sql` existed. Wipe and recreate:

```powershell
docker compose -f docker-compose.dev.yml down -v
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

`down -v` deletes the database volume. Harmless now; never run it once real data
exists.

**Tests fail** — send me the output. It means something in the money or state
logic did not survive the install, and that is worth knowing before any UI is
built on top of it.
