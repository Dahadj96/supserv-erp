# FREEING SPACE ON SUPSERVPC01

Target: **60 GB free on C:** before the ERP environment goes on it.
Starting point from the screenshot: 24 GB free of 232 GB.

Two tools, both **free for business use** — I checked the licences, because some
popular ones are not.

---

## The two tools to install

### 1 · TreeSize Free — *what is actually eating the disk*

**jam-software.com/treesize_free** · free, and the vendor states plainly that it
**may be used in commercial and enterprise environments**.

Run it **as Administrator** (right-click → Run as administrator), point it at
`C:\`, and it draws every folder sorted biggest first. Five minutes with this
tells you more than an hour of guessing.

The usual culprits on a machine like yours, in the order they usually appear:

| Folder | Typically | What it is |
|---|---|---|
| `C:\Users\ABDOU PC\OneDrive - supserv` | **10–80 GB** | Files synced down that you rarely open |
| `C:\Windows.old` | 15–25 GB | The previous Windows version. Safe to remove |
| `C:\Program Files (x86)\Steam\steamapps` | 5–50 GB | Games, and `common` folders left behind |
| `C:\Users\...\AppData\Local\Temp` | 2–10 GB | Rubbish |
| `C:\Windows\SoftwareDistribution\Download` | 2–8 GB | Old Windows Update files |
| `C:\Users\...\Downloads` | varies | Installers you already ran |

### 2 · Bulk Crap Uninstaller — *programs, games and what they left behind*

**github.com/Klocman/Bulk-Crap-Uninstaller** · Apache 2.0, explicitly free for
**private and commercial** use.

This is the one that does exactly what you asked. It lists everything installed —
normal programs, **Steam games**, Windows Store apps — and it does two things the
Windows uninstaller cannot:

- **Finds orphaned applications** — folders and registry entries from software
  that was already removed badly, or a game whose files stayed after the
  uninstall.
- **Cleans up leftovers** after each uninstall, instead of leaving a 3 GB
  `steamapps\common\<game>` folder sitting there forever.

**How to use it safely:**

1. Sort by **Size**, largest first.
2. Tick the games and programs nobody in the office uses.
3. **Uninstall** — it runs each uninstaller in turn without you clicking through
   every dialog.
4. When it finishes, run **Tools → Uninstall leftovers**, review the list, and
   accept what is clearly rubbish.

**Do not tick anything you do not recognise.** If a name means nothing to you,
leave it. The space is not worth breaking something.

---

## Then the built-in ones, which often win biggest

These cost nothing and need no download.

**1 · OneDrive Files On-Demand — usually the single largest recovery.**
Your OneDrive sidebar is long. Right-click any folder you do not open weekly →
**Free up space**. The files stay safe in OneDrive and download again in seconds
when you open them. On an office PC this commonly recovers **30–80 GB**, and
nothing is lost.

Start with the biggest and oldest: old project folders, `Scans`, `Attachments`,
finished years.

**2 · Disk Cleanup, including system files.**
`Win + R` → `cleanmgr` → choose C: → **Clean up system files** → tick:

- **Previous Windows installation(s)** ← often 15–25 GB on its own
- Windows Update Cleanup
- Temporary files
- Delivery Optimization Files
- Recycle Bin

**3 · Storage Sense**, so this does not happen again.
Settings → System → Storage → **Storage Sense on**. Set it to empty the Recycle
Bin after 30 days and clear temp files automatically.

---

## What not to install

**Avoid "PC cleaner", "registry cleaner", "driver updater" and one-click
optimiser products.** They are the most reliable way to break a working Windows
machine, several bundle software you did not ask for, and none of them free more
space than `cleanmgr` and TreeSize already show you.

There is no registry cleaning in this list on purpose. It has never been a real
source of disk space, and on a machine that is about to hold your company's
accounts it is a bad trade.

---

## Check your progress

PowerShell, any time:

```powershell
Get-PSDrive C | Select-Object @{n='UsedGB';e={[math]::Round($_.Used/1GB,1)}}, @{n='FreeGB';e={[math]::Round($_.Free/1GB,1)}}
```

Stop when **FreeGB** is comfortably above 60.

---

## One thing to know for later

Docker's virtual disk on Windows grows and **does not shrink by itself** when you
delete images. Today it is only 2.5 GB, but after a few months of building it can
reach 30 GB while showing far less in use. When that day comes:

```powershell
docker system prune -a --volumes     # careful: removes unused volumes too
wsl --shutdown
Optimize-VHD -Path "$env:LOCALAPPDATA\Docker\wsl\disk\docker_data.vhdx" -Mode Full
```

This is another reason the production server ends up on Ubuntu, where the disk is
just the disk.
