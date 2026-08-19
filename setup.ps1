# =============================================================================
#  SUPSERV ERP  —  one-time environment setup for SUPSERVPC01
#
#  Run ONCE, in PowerShell as Administrator, from this folder:
#      powershell -ExecutionPolicy Bypass -File .\setup.ps1
#
#  It installs what is missing, starts the database, and verifies everything.
#  Safe to run again — every step checks before it acts.
# =============================================================================

$ErrorActionPreference = "Stop"

# --- run from wherever this file lives, not wherever the prompt happened to be
if ($PSScriptRoot) { Set-Location $PSScriptRoot }

# --- re-launch elevated if needed (winget needs it)
$isAdmin = ([Security.Principal.WindowsPrincipal] `
            [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Restarting as Administrator..." -ForegroundColor Yellow
  Start-Process powershell -Verb RunAs -ArgumentList @(
    "-ExecutionPolicy","Bypass","-NoExit","-File","`"$PSCommandPath`""
  )
  exit 0
}

# --- sanity: are we actually in the project?
if (-not (Test-Path ".\package.json")) {
  Write-Host "`nThis does not look like the SUPSERV ERP folder." -ForegroundColor Red
  Write-Host "Current folder: $(Get-Location)"
  Write-Host "Expected to find package.json here.`n"
  Write-Host "Open the project folder in File Explorer, type  powershell  in the" -ForegroundColor Yellow
  Write-Host "address bar, press Enter, then run:  .\setup.ps1`n" -ForegroundColor Yellow
  Read-Host "Press Enter to close"
  exit 1
}

$ok = @(); $warn = @(); $fail = @()

function Step($n)  { Write-Host "`n=== $n ===" -ForegroundColor Cyan }
function Good($m)  { Write-Host "  OK    $m" -ForegroundColor Green; $script:ok   += $m }
function Warn($m)  { Write-Host "  WARN  $m" -ForegroundColor Yellow; $script:warn += $m }
function Bad($m)   { Write-Host "  FAIL  $m" -ForegroundColor Red;   $script:fail += $m }

Write-Host "SUPSERV ERP environment setup" -ForegroundColor White
Write-Host (Get-Location)

# ---------------------------------------------------------------- 1. disk
Step "1 / 8   Disk space"
$c = Get-PSDrive C
$freeGB = [math]::Round($c.Free / 1GB, 1)
if ($freeGB -ge 50) { Good "C: has $freeGB GB free" }
elseif ($freeGB -ge 25) { Warn "C: has only $freeGB GB free - see docs/DISK-CLEANUP.md" }
else { Bad "C: has only $freeGB GB free. Free space before continuing." }

# ---------------------------------------------------------------- 2. wslconfig
Step "2 / 8   WSL 2 memory limits"
# Docker Desktop on the WSL 2 backend has NO memory/CPU sliders. Windows owns
# those limits, and they live in %UserProfile%\.wslconfig. Without this file WSL
# takes up to half the RAM (4 GB here) plus cache, and the desktop crawls.
$wslcfg = Join-Path $env:USERPROFILE ".wslconfig"
$wanted = @"
# SUPSERV ERP - WSL 2 limits for an 8 GB machine.
# Docker Desktop uses the WSL 2 backend, so its Settings screen has no sliders.
# Apply changes with:  wsl --shutdown   then reopen Docker Desktop.
[wsl2]
memory=4GB
processors=2
swap=2GB

[experimental]
autoMemoryReclaim=gradual
sparseVhd=true
"@
$changed = $true
if (Test-Path $wslcfg) {
  $current = (Get-Content $wslcfg -Raw)
  if ($current.Trim() -eq $wanted.Trim()) { $changed = $false }
  else { Copy-Item $wslcfg "$wslcfg.backup" -Force; Warn "Existing .wslconfig backed up to .wslconfig.backup" }
}
if ($changed) {
  $wanted | Set-Content $wslcfg -Encoding ASCII
  Good "Wrote $wslcfg  (memory 4GB, 2 CPUs, swap 2GB)"
  Write-Host ""
  Write-Host "  ACTION NEEDED - the new limits are not live yet:" -ForegroundColor Yellow
  Write-Host "    1. Quit Docker Desktop completely (right-click tray icon, Quit)" -ForegroundColor Yellow
  Write-Host "    2. Run:  wsl --shutdown" -ForegroundColor Yellow
  Write-Host "    3. Start Docker Desktop again" -ForegroundColor Yellow
  Write-Host "    4. Run this script again - it will carry on from here" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Stopped. Nothing else was changed." -ForegroundColor Yellow
  exit 0
} else {
  Good ".wslconfig already correct (4 GB, 2 CPUs, swap 2 GB, sparse disk)"
}

# ---------------------------------------------------------------- 3. docker
Step "3 / 8   Docker"
try {
  $null = docker version --format '{{.Server.Version}}' 2>$null
  if ($LASTEXITCODE -ne 0) { throw }
  Good "Docker engine is running"
} catch {
  Bad "Docker is not running. Start Docker Desktop, wait for the whale to go steady, then run this again."
  Write-Host "`nStopped. Nothing was changed." -ForegroundColor Red
  exit 1
}

# ---------------------------------------------------------------- 3. tools
Step "4 / 8   Node, pnpm and Git"

function Have($cmd) { $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue) }

if (-not (Have node)) {
  Write-Host "  installing Node.js LTS ..."
  winget install --silent --accept-package-agreements --accept-source-agreements OpenJS.NodeJS.LTS
  $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
              [Environment]::GetEnvironmentVariable("Path","User")
}
if (Have node) { Good "Node $(node -v)" } else { Bad "Node install failed - close this window, open a new PowerShell, run setup.ps1 again" }

if (-not (Have git)) {
  Write-Host "  installing Git ..."
  winget install --silent --accept-package-agreements --accept-source-agreements Git.Git
  $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
              [Environment]::GetEnvironmentVariable("Path","User")
}
if (Have git) { Good "$(git --version)" } else { Warn "Git not on PATH yet - reopen PowerShell after this finishes" }

if (Have node) {
  corepack enable 2>$null
  corepack prepare pnpm@10.15.0 --activate 2>$null
  if (Have pnpm) { Good "pnpm $(pnpm -v)" } else { Bad "pnpm not available" }
}

# ---------------------------------------------------------------- 4. .env
Step "5 / 8   Configuration"
if (Test-Path ".env") {
  Good ".env already exists - left untouched"
} else {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = [Convert]::ToBase64String($bytes)

  $env_text = Get-Content ".env.example" -Raw
  # dev runs the app on Windows, so the database is on localhost, not the container name
  $env_text = $env_text -replace 'DATABASE_URL=.*', 'DATABASE_URL=postgres://supserv:devpassword@localhost:5432/supserv'
  $env_text = $env_text -replace 'BETTER_AUTH_SECRET=.*', "BETTER_AUTH_SECRET=$secret"
  $env_text = $env_text -replace 'APP_URL=.*', 'APP_URL=http://localhost:3000'
  $env_text = $env_text -replace 'BETTER_AUTH_URL=.*', 'BETTER_AUTH_URL=http://localhost:3000'
  $env_text | Set-Content ".env" -Encoding UTF8
  Good ".env created, with a fresh BETTER_AUTH_SECRET"
  Warn "Microsoft 365 keys in .env are still blank - fill them when you reach phase 2"
}

# ---------------------------------------------------------------- 5. database
Step "6 / 8   Database"
docker compose -f docker-compose.dev.yml up -d 2>&1 | Out-Null
Write-Host "  waiting for Postgres ..."
$up = $false
foreach ($i in 1..30) {
  Start-Sleep -Seconds 2
  docker exec supserv-db pg_isready -U supserv 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { $up = $true; break }
}
if ($up) {
  Good "Postgres is accepting connections on localhost:5432"
  $ext = docker exec supserv-db psql -U supserv -d supserv -tAc `
         "select string_agg(extname,',' order by extname) from pg_extension where extname in ('pg_trgm','unaccent','citext')"
  $ext = "$ext".Trim()
  if ($ext -eq "citext,pg_trgm,unaccent") { Good "Extensions installed: $ext" }
  else { Bad "Extensions missing. Found '$ext'. Run: docker compose -f docker-compose.dev.yml down -v  then this script again" }
} else {
  Bad "Postgres did not become ready. Check: docker logs supserv-db"
}

# ---------------------------------------------------------------- 6. deps
Step "7 / 8   Dependencies and tests"
if (Have pnpm) {
  Write-Host "  pnpm install (a few minutes the first time) ..."
  pnpm install 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Good "Dependencies installed" } else { Bad "pnpm install failed" }

  Write-Host "  running the tests ..."
  $testOut = pnpm test 2>&1 | Out-String
  if ($testOut -match "10 passed") { Good "10 / 10 tests passed - money and state logic verified on this machine" }
  elseif ($LASTEXITCODE -eq 0) { Good "Tests passed" }
  else { Bad "Tests failed. Output:`n$testOut" }
} else { Warn "Skipped - pnpm not available yet" }

# ---------------------------------------------------------------- 7. git
Step "8 / 8   Version control"
if (Test-Path ".git") {
  Good "Git repository already initialised"
} elseif (Have git) {
  git init -q
  git add -A 2>$null
  git -c user.email="dahadj@supserv.dz" -c user.name="A. Dahadj" commit -q -m "SUPSERV ERP - scaffold, plan and 86 screens" 2>$null
  Good "Git repository created, first commit made"
  Warn "Add a private remote soon (GitHub or Gitea) - OneDrive backs up files, Git backs up decisions"
} else { Warn "Skipped - Git not on PATH yet" }

# ---------------------------------------------------------------- summary
Write-Host "`n=====================================================" -ForegroundColor White
if ($fail.Count -eq 0) {
  Write-Host " ENVIRONMENT IS READY" -ForegroundColor Green
  Write-Host "=====================================================" -ForegroundColor White
  Write-Host @"

  Postgres   localhost:5432   user supserv / devpassword
  Stop it    docker compose -f docker-compose.dev.yml stop
  Start it   docker compose -f docker-compose.dev.yml up -d

  NEXT: open Claude Code in this folder and say

      Read CLAUDE.md and docs/SCREENS.md, then start Phase 0.
      Scaffold the Next.js 16 app with next-intl (fr + en), Tailwind 4,
      Drizzle and better-auth. Build the shell first: sidebar, topbar and
      the avatar menu with the working language switch. Screens 80 and 81.

"@
} else {
  Write-Host " NOT READY - $($fail.Count) problem(s)" -ForegroundColor Red
  Write-Host "=====================================================" -ForegroundColor White
  $fail | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}
if ($warn.Count) { Write-Host "`n Warnings:" -ForegroundColor Yellow; $warn | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow } }
Write-Host ""

Read-Host "Press Enter to close"
