# Make the mini PC behave like a server.
#
# Run ONCE, from an Administrator PowerShell:
#     cd C:\SUPSERV-ERP
#     powershell -ExecutionPolicy Bypass -File scripts\server\install-services.ps1
#
# After this, a reboot brings back: the tunnel, the database, and the ERP.
# What it does NOT fix on its own is in docs/RUNBOOK.md §3 — Docker Desktop on
# Windows needs somebody logged in, and that is a decision, not a script.

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$repo = "C:\SUPSERV-ERP"
$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"

function Say($text) { Write-Host "`n=== $text" -ForegroundColor Cyan }

# ---------------------------------------------------------------- 1. tunnel
Say "cloudflared as a Windows service"

if (-not (Test-Path $cloudflared)) { throw "cloudflared not found at $cloudflared" }

if (Get-Service cloudflared -ErrorAction SilentlyContinue) {
  Write-Host "already installed — leaving it alone"
} else {
  # Reads C:\Users\<you>\.cloudflared\config.yml, which already names the tunnel
  # and points erp.supserv-dz.com at localhost:3000.
  & $cloudflared --config "$env:USERPROFILE\.cloudflared\config.yml" service install
}

Set-Service cloudflared -StartupType Automatic
Start-Service cloudflared -ErrorAction SilentlyContinue
Get-Service cloudflared | Format-Table Name, Status, StartType -AutoSize

# ------------------------------------------------------------- 2. the app
Say "the ERP as a scheduled task that starts with Windows"

# Production build, not the dev server: a dev server ships unminified source and
# readable stack traces, and this one is reachable from the internet.
# scripts\server\mode.ps1 switches to dev while we are working together.
$run = Join-Path $repo "scripts\server\run-erp.ps1"

$action    = New-ScheduledTaskAction -Execute "powershell.exe" `
              -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$run`"" `
              -WorkingDirectory $repo
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
              -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
              -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

Register-ScheduledTask -TaskName "SUPSERV ERP" -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "registered task 'SUPSERV ERP' (at startup, restarts up to 3 times if it dies)"

# ------------------------------------------------------- 3. docker desktop
Say "Docker Desktop on login"

$docker = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
if (Test-Path $docker) {
  New-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" `
    -Name "Docker Desktop" -Value "`"$docker`" -Autostart" -PropertyType String -Force | Out-Null
  Write-Host "Docker Desktop will start when this user logs in"
} else {
  Write-Warning "Docker Desktop not found at $docker — start it by hand or install it"
}

# The database container already restarts by itself once the engine is up.
docker update --restart unless-stopped supserv-db 2>$null | Out-Null

# ------------------------------------------------------------- 4. the gap
Say "What is still not automatic"

$auto = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' `
          -Name AutoAdminLogon -ErrorAction SilentlyContinue).AutoAdminLogon

if ($auto -ne "1") {
  Write-Warning @"
Docker Desktop on Windows runs inside a logged-in user session. There is no
supported way to run it as a service. So after a power cut this machine will
boot, start cloudflared, start the ERP - and the ERP will have no database,
because nobody logged in.

Three ways out, in docs/RUNBOOK.md section 3. Pick one deliberately:
  a) turn on automatic login  (fastest, and it weakens physical security)
  b) install PostgreSQL natively as a Windows service, drop Docker from the
     critical path
  c) do the Ubuntu migration that docs/SERVER.md already plans

Until one of those is done, 'it comes back by itself' is not true.
"@
} else {
  Write-Host "automatic login is on — Docker Desktop will come back after a reboot"
}

Say "Done"
Write-Host "Check it with:  scripts\server\status.ps1"
