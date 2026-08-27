# What the scheduled task runs at boot.
#
# Waits for the database, then serves the PRODUCTION build on port 3000 -
# the port the tunnel already points at.

$ErrorActionPreference = "Continue"
Set-Location "C:\SUPSERV-ERP"

$log = "C:\SUPSERV-ERP\.data\server.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
function Log($text) { "$(Get-Date -Format s)  $text" | Tee-Object -FilePath $log -Append }

Log "starting"

# Docker Desktop takes a while after a reboot, and Postgres a little longer.
# Failing fast here would mean the ERP is down until somebody notices, so it
# waits - up to five minutes - and says so in the log either way.
$deadline = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $deadline) {
  docker exec supserv-db pg_isready -U supserv 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { Log "database is up"; break }
  Start-Sleep -Seconds 5
}

if ($LASTEXITCODE -ne 0) {
  Log "GIVING UP WAITING FOR THE DATABASE - is Docker Desktop running? Is anybody logged in?"
}

# `pnpm start` serves .next from the last `pnpm build`. If nobody has built,
# build now rather than serve nothing.
if (-not (Test-Path "C:\SUPSERV-ERP\.next\BUILD_ID")) {
  Log "no build found - building"
  pnpm build 2>&1 | Tee-Object -FilePath $log -Append
}

Log "serving on http://localhost:3000"
pnpm start 2>&1 | Tee-Object -FilePath $log -Append
