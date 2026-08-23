# Switch between the two ways the ERP runs on port 3000.
#
#     scripts\server\mode.ps1 dev      hot reload, for while we are building
#     scripts\server\mode.ps1 server   the production build, for a real server
#     scripts\server\mode.ps1 status   which one is running
#
# The tunnel does not care: both listen on 3000 and erp.supserv-dz.com points
# at 3000 either way.

param([Parameter(Position = 0)][ValidateSet("dev", "server", "status")] [string]$Mode = "status")

$ErrorActionPreference = "Stop"
Set-Location "C:\SUPSERV-ERP"

function Stop-Erp {
  Get-ScheduledTask -TaskName "SUPSERV ERP" -ErrorAction SilentlyContinue | Stop-ScheduledTask
  Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

switch ($Mode) {
  "dev" {
    Stop-Erp
    Write-Host "dev server on http://localhost:3000 — reachable at https://erp.supserv-dz.com" -ForegroundColor Cyan
    Write-Warning "A dev server ships unminified source and readable stack traces. Fine while the database holds test rows; switch back before real client data."
    pnpm dev
  }

  "server" {
    Stop-Erp
    Write-Host "building..." -ForegroundColor Cyan
    pnpm build
    Start-ScheduledTask -TaskName "SUPSERV ERP"
    Write-Host "started as a service. It will come back on its own after a reboot." -ForegroundColor Green
  }

  "status" {
    $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($listener) {
      $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
      Write-Host "port 3000: $($proc.ProcessName) (pid $($proc.Id))"
    } else {
      Write-Host "port 3000: nothing listening" -ForegroundColor Yellow
    }

    Get-Service cloudflared -ErrorAction SilentlyContinue |
      Format-Table Name, Status, StartType -AutoSize
    Get-ScheduledTask -TaskName "SUPSERV ERP" -ErrorAction SilentlyContinue |
      Format-Table TaskName, State -AutoSize
    docker ps --filter name=supserv-db --format "db: {{.Status}}"
  }
}
