# Restart the ERP onto the build that is on disk right now.
#
# WHY THIS EXISTS. The scheduled task runs as SYSTEM, so stopping it needs
# Administrator - and the failure when you forget is three "Access is denied"
# messages naming Stop-ScheduledTask, Stop-Process and Start-ScheduledTask
# separately, none of which says "this window is not elevated". That was
# diagnosed by hand eight times in one evening.
#
# WHY IT NO LONGER ELEVATES UNCONDITIONALLY, changed 30 Aug 2026.
#
# It used to elevate first and then call Start-ScheduledTask "SUPSERV ERP".
# That task DOES NOT EXIST on this machine - `Get-ScheduledTask` returns
# nothing for it - so the script's last act was to fail, and the only way the
# ERP was running at all was that somebody had started it by hand. It then sat
# on a two-day-old build serving 404 for /dashboard, /reports and every other
# route added since, with the sidebar linking straight at them.
#
# The RUNBOOK said section 3 was done. Nothing had ever asked Windows.
#
# So the script now works out what it actually needs. No task and a process
# owned by this account is a plain restart that any window can do; a task, or a
# process owned by SYSTEM, needs Administrator and it asks for it then. And it
# says, every time, whether this machine can come back on its own.

$ErrorActionPreference = "Stop"
$task = "SUPSERV ERP"
$worker = "SUPSERV worker"
$repo = "C:\SUPSERV-ERP"
$node = "C:\Program Files\nodejs\node.exe"
$next = "C:\SUPSERV-ERP\node_modules\next\dist\bin\next"
$log = "C:\SUPSERV-ERP\.data\server.log"

function Say($text) { Write-Host "`n=== $text" -ForegroundColor Cyan }

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

$registered = [bool](Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue)

if (-not $registered) {
  Write-Warning @"
THERE IS NO '$task' SCHEDULED TASK ON THIS MACHINE.

The ERP does not come back after a reboot or a power cut. cloudflared does -
it is a real Windows service - so the tunnel will be up and pointing at
nothing, which answers with a Cloudflare error page rather than silence.

Fix it once, from an Administrator PowerShell:
    cd C:\SUPSERV-ERP
    powershell -ExecutionPolicy Bypass -File scripts\server\install-services.ps1

This script carries on and restarts what is running now.
"@
}

# A scheduled task runs as SYSTEM, so stopping THAT always needs elevation.
# Everything else is found out by trying.
if ($registered -and -not $isAdmin) {
  Write-Host "The scheduled task runs as SYSTEM - asking Windows for permission..." -ForegroundColor Yellow
  Start-Process powershell.exe -Verb RunAs -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit",
    "-File", "`"$PSCommandPath`""
  )
  exit 0
}

Say "stopping"

if ($registered) {
  # Stop the task before the process. Killing the process while the task still
  # owns it means the task restarts it - under the old build.
  Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
}

# TRY, THEN ASK. The first version of this decided in advance, by reading the
# owner of the process on port 3000 - and Win32_Process.GetOwner returns an
# EMPTY owner rather than an error when the caller may not see it. An empty
# string is not this account's name, so the script asked for Administrator
# every single time, including when it did not need it. A permission prompt
# nobody can answer is worse than no script.
#
# By port, not by name: `node` also runs this repository's tooling and a build
# in another window, and killing every node would take those with it.
foreach ($connection in @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
  Write-Host "  killing pid $($connection.OwningProcess) on port 3000"
  Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

if (@(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue).Count -gt 0) {
  if ($isAdmin) { throw "Something still holds port 3000 and this window IS elevated. Look at it by hand." }
  Write-Host "It would not die from here - asking Windows for permission..." -ForegroundColor Yellow
  Start-Process powershell.exe -Verb RunAs -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit",
    "-File", "`"$PSCommandPath`""
  )
  exit 0
}

Say "starting"

if (-not (Test-Path "$repo\.next\BUILD_ID")) { throw "no build on disk - run pnpm build first" }

if ($registered) {
  Start-ScheduledTask -TaskName $task
} else {
  if (-not (Test-Path $node)) { throw "node not found at $node" }
  if (-not (Test-Path $next)) { throw "next not found at $next - run pnpm install" }

  New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
  if (Test-Path $log) { Move-Item -Path $log -Destination "$log.1" -Force -ErrorAction SilentlyContinue }

  # Start-Process, so the server outlives the window that started it. Same log
  # file run-erp.ps1 writes, because there is one place to look either way the
  # ERP was started.
  Start-Process -FilePath $node -ArgumentList $next, "start" -WorkingDirectory $repo `
    -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err"
}

Say "waiting for it to answer"

# A LISTENING PORT IS NOT A WORKING SERVER, and that distinction has cost this
# project a day twice - once believing a cloudflared service was up because
# Windows said Running, once believing the ERP was up because 3000 was bound.
# So this asks for a page and accepts any HTTP answer, including a redirect to
# sign-in, which is what an unauthenticated request is SUPPOSED to get.
$up = $false
$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  try {
    Invoke-WebRequest -Uri "http://localhost:3000/fr/sign-in" -UseBasicParsing -TimeoutSec 5 | Out-Null
    $up = $true; break
  } catch {
    if ($_.Exception.Response) { $up = $true; break }
  }
}

if (-not $up) {
  Write-Host "`nNothing answering on port 3000 after 90 seconds." -ForegroundColor Red
  Write-Host "Read the log:  Get-Content C:\SUPSERV-ERP\.data\server.log -Tail 30"
  exit 1
}

Write-Host "`nERP is up: http://localhost:3000" -ForegroundColor Green
Write-Host "Public:    https://erp.supserv-dz.com"

# THE WORKER TOO, and this is not tidiness.
#
# Added 9 September 2026, after the trap it prevents had already been walked
# into. The worker is a long-running node process started from source; it holds
# whatever handlers existed when it started. On 9 September it had been running
# since 02:25, so it carried no `dossier.read` handler at all - that queue
# arrived at 02:31 with 1.6 and 02:49 with 1.8. Restarting only the ERP put a
# new build on port 3000 in front of a worker that could not do the new work,
# and nothing on any screen says that: attachments simply arrive and are never
# read.
#
# One restart means one machine, not one process. If the task is not registered
# there is nothing to restart and the worker is somebody's console window -
# say so, because that is the same silent-capture failure wearing a hat.
Say "the worker"

if (Get-ScheduledTask -TaskName $worker -ErrorAction SilentlyContinue) {
  # Stop then Start, NOT Restart-ScheduledTask.
  #
  # There is no `Restart-ScheduledTask` cmdlet. The ScheduledTasks module ships
  # Get / Start / Stop / Enable / Disable / Register / Unregister / Set and
  # nothing else, so the first version of this block died with
  # CommandNotFoundException at line 167 - after the ERP had already restarted,
  # which is the worst place for it: the run looked successful, the new build
  # was on port 3000, and the worker was still the old process.
  Stop-ScheduledTask -TaskName $worker -ErrorAction SilentlyContinue

  # Stop-ScheduledTask returns before the process is gone, and a worker holding
  # the pg-boss connection needs a moment to let go of it.
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-ScheduledTask -TaskName $worker).State -eq "Running" -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 1
  }

  Start-ScheduledTask -TaskName $worker
  Start-Sleep -Seconds 15

  # "Running" means a process exists. The worker announces itself on its first
  # line; that is what is checked, for the same reason as the port above.
  $log = "C:\SUPSERV-ERP\.data\worker.log"
  $recent = if (Test-Path $log) { Get-Content $log -Tail 40 } else { @() }

  if ($recent -match "\[worker\] up") {
    Write-Host "worker restarted and reading the mailbox on a clock" -ForegroundColor Green
  } else {
    Write-Warning "The worker task restarted but has not said '[worker] up'. Read $log"
  }
} else {
  Write-Warning @"
THERE IS NO '$worker' SCHEDULED TASK.

Nothing reads the mailbox or fetches attachment bytes unless somebody is
holding a console window open, and after a reboot nobody is. Mail stops
arriving and no screen says so.

Fix it once, from an Administrator PowerShell:
    cd C:\SUPSERV-ERP
    powershell -ExecutionPolicy Bypass -File scripts\server\install-services.ps1
"@
}

if (-not $registered) {
  Write-Host "`nStill not a service. One reboot and this is down until somebody runs it by hand." -ForegroundColor Yellow
}
