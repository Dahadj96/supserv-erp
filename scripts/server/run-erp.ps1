# What the scheduled task runs at boot.
#
# Waits for the database, then serves the PRODUCTION build on port 3000 -
# the port the tunnel already points at.
#
# THIS RUNS AS SYSTEM. That is the fact everything below is shaped by, and it
# is what broke the first real attempt: the script called `pnpm`, which lives
# at C:\Users\Abderrahmane\AppData\Roaming\npm\pnpm.ps1 and is on that USER's
# PATH only. SYSTEM gets the machine PATH, where there is no pnpm - so the
# command was not found, the error went to a discarded stderr, and the log
# stopped after "serving on http://localhost:3000" with the port never opening.
#
# So: nothing here may depend on a per-user install. Next is invoked through
# node, which IS machine-wide, using an absolute path into node_modules.
# `next start` also loads .env by itself, which the standalone server would not
# - which is why next.config.ts must not set `output: "standalone"`. It says so
# there too.

$ErrorActionPreference = "Continue"
Set-Location "C:\SUPSERV-ERP"

$log = "C:\SUPSERV-ERP\.data\server.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

# One boot per file, with the previous boot kept beside it.
#
# This log was appended to forever, which is how it ended up half UTF-16 and
# half UTF-8: unreadable from the moment two writers with different encodings
# had both touched it, and unreadable for the whole file, because a reader
# decides the encoding from the BOM at the start. Rotating means a bad line can
# never poison the run after it - and the first line of this file is always the
# start of the run somebody is actually asking about.
if (Test-Path $log) { Move-Item -Path $log -Destination "${log}.1" -Force -ErrorAction SilentlyContinue }

# PowerShell 5.1's Tee-Object takes no -Encoding and writes UTF-16, so the log
# came back out of every other tool as g i b b e r i s h  s p a c e d  l i k e
# t h i s - and half the file was ASCII, because two different writers were
# appending to it. Out-File with an explicit encoding is the fix; Write-Host
# keeps the console copy that Tee-Object was there for.
filter Add-Log { $_ | Out-File -FilePath $log -Append -Encoding utf8; Write-Host $_ }
function Log($text) { "$(Get-Date -Format s)  $text" | Add-Log }

Log "starting (as $env:USERNAME)"

$node = "C:\Program Files\nodejs\node.exe"
$next = "C:\SUPSERV-ERP\node_modules\next\dist\bin\next"

# Checked, and LOGGED when missing. The original failure was invisible, which
# cost more than the failure did: a script that dies without saying why is a
# script somebody debugs by guessing.
if (-not (Test-Path $node)) { Log "FATAL: node not found at $node"; exit 1 }
if (-not (Test-Path $next)) { Log "FATAL: next not found at $next - has pnpm install been run?"; exit 1 }

# Docker Desktop takes a while after a reboot, and Postgres a little longer.
# Failing fast here would mean the ERP is down until somebody notices, so it
# waits - up to five minutes - and says so in the log either way.
$dbUp = $false
$deadline = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $deadline) {
  docker exec supserv-db pg_isready -U supserv 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $dbUp = $true; Log "database is up"; break }
  Start-Sleep -Seconds 5
}

if (-not $dbUp) {
  Log "GIVING UP WAITING FOR THE DATABASE - is Docker Desktop running? Is anybody logged in?"
  Log "See docs/RUNBOOK.md section 3. Serving anyway so the reason is visible in the browser."
}

# `next start` serves .next from the last build. If nobody has built, build now
# rather than serve nothing.
if (-not (Test-Path "C:\SUPSERV-ERP\.next\BUILD_ID")) {
  Log "no build found - building"
  & $node $next build 2>&1 | Add-Log
  if ($LASTEXITCODE -ne 0) { Log "FATAL: build failed with exit code $LASTEXITCODE"; exit 1 }
}

Log "serving on http://localhost:3000"
& $node $next start 2>&1 | Add-Log

# Only reached when the server stops. Saying so beats a log that simply ends.
Log "server exited with code $LASTEXITCODE"
