# Restart the ERP. Run it from anywhere; it elevates itself.
#
# WHY THIS EXISTS. The scheduled task runs as SYSTEM, so stopping it needs
# Administrator - and the failure when you forget is three "Access is denied"
# messages that name Stop-ScheduledTask, Stop-Process and Start-ScheduledTask
# separately, none of which says "this window is not elevated". That was
# diagnosed by hand eight times in one evening.
#
# So: double-click restart.cmd, or run this. It re-launches itself elevated,
# and Windows asks you the one question that is actually being asked.

$ErrorActionPreference = "Stop"
$task = "SUPSERV ERP"

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Host "Not elevated - asking Windows for permission..." -ForegroundColor Yellow
  Start-Process powershell.exe -Verb RunAs -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit",
    "-File", "`"$PSCommandPath`""
  )
  exit 0
}

Write-Host "`n=== Stopping ===" -ForegroundColor Cyan

# sc.exe-style: send the stop and do not block on it. Stop-ScheduledTask does
# not hang the way Stop-Service did, but the process it started can outlive it,
# which is what the kill below is for.
Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

# By port, not by name. `node` also runs this repository's tooling and a build
# in another window; killing every node on the machine would take those with it.
$listening = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
foreach ($connection in $listening) {
  Write-Host "  killing pid $($connection.OwningProcess) on port 3000"
  Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

Write-Host "`n=== Starting ===" -ForegroundColor Cyan
Start-ScheduledTask -TaskName $task

# It takes a few seconds to bind. Saying "started" before it listens is how you
# end up debugging a server that was simply not ready yet - which also cost an
# evening, from the other direction.
Write-Host "  waiting for port 3000..."
$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
  if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "`nERP is up: http://localhost:3000" -ForegroundColor Green
    Write-Host "Public:    https://erp.supserv-dz.com"
    exit 0
  }
  Start-Sleep -Seconds 2
}

Write-Host "`nStill nothing on port 3000 after 90 seconds." -ForegroundColor Red
Write-Host "Read the log:  Get-Content C:\SUPSERV-ERP\.data\server.log -Tail 30"
exit 1
