# What the scheduled task runs at boot, beside the ERP.
#
# The web app enqueues; this empties the queue. Without it the mailbox is never
# read on a clock, "Sync now" queues a poll nobody runs, and every attachment
# that arrives keeps a null storage_path and says "not copied here yet" on
# screen 40 forever. Nothing on screen says the worker is missing, which is
# exactly why it has to come back by itself.
#
# THIS RUNS AS SYSTEM, and that is the fact every line below is shaped by. It is
# the same trap that broke run-erp.ps1 on its first real attempt: `pnpm` lives
# at C:\Users\Abderrahmane\AppData\Roaming\npm\pnpm.ps1 and is on THAT user's
# PATH only. SYSTEM gets the machine PATH, where there is no pnpm. So nothing
# here may go through pnpm - node is machine-wide, and tsx is reached by an
# absolute path into node_modules.

$ErrorActionPreference = "Continue"
Set-Location "C:\SUPSERV-ERP"

$log = "C:\SUPSERV-ERP\.data\worker.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

# One boot per file, with the previous boot kept beside it - same reasoning as
# run-erp.ps1, and the same fix for the same UTF-16 mess.
if (Test-Path $log) { Move-Item -Path $log -Destination "${log}.1" -Force -ErrorAction SilentlyContinue }

filter Add-Log { $_ | Out-File -FilePath $log -Append -Encoding utf8; Write-Host $_ }
function Log($text) { "$(Get-Date -Format s)  $text" | Add-Log }

Log "starting (as $env:USERNAME)"

$node = "C:\Program Files\nodejs\node.exe"
$tsx  = "C:\SUPSERV-ERP\node_modules\tsx\dist\cli.mjs"

if (-not (Test-Path $node)) { Log "FATAL: node not found at $node"; exit 1 }
if (-not (Test-Path $tsx))  { Log "FATAL: tsx not found at $tsx - has pnpm install been run?"; exit 1 }

# The worker needs the database for the queue itself, not only for the work, so
# starting before Postgres exists is starting to crash. Wait, and say so either
# way. Ten minutes, for the same reason run-erp.ps1 waits ten: Docker Desktop
# needs somebody logged in, so the database can be minutes behind the boot.
$dbUp = $false
$deadline = (Get-Date).AddMinutes(10)
while ((Get-Date) -lt $deadline) {
  docker exec supserv-db pg_isready -U supserv 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $dbUp = $true; Log "database is up"; break }
  Start-Sleep -Seconds 5
}

if (-not $dbUp) {
  Log "GIVING UP WAITING FOR THE DATABASE - is Docker Desktop running? Is anybody logged in?"
  Log "See docs/RUNBOOK.md section 3. Starting anyway so the reason is in this log."
}

# --env-file is a node flag; tsx forwards it to the node it spawns. It is not
# optional: DATABASE_URL and the Graph credentials live in .env, and a worker
# without them throws on its first line.
Log "starting the worker"
& $node $tsx --env-file=.env src/jobs/worker.ts 2>&1 | Add-Log

# Only reached when it stops. The task restarts it three times; a log that
# simply ends tells nobody which of those this was.
Log "worker exited with code $LASTEXITCODE"
