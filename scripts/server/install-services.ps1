# Make the mini PC behave like a server.
#
# Run ONCE, from an Administrator PowerShell:
#     cd C:\SUPSERV-ERP
#     powershell -ExecutionPolicy Bypass -File scripts\server\install-services.ps1
#
# After this, a reboot brings back: the tunnel, the database, and the ERP.
# What it does NOT fix on its own is in docs/RUNBOOK.md section 3 - Docker Desktop on
# Windows needs somebody logged in, and that is a decision, not a script.

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$repo = "C:\SUPSERV-ERP"
$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"

function Say($text) { Write-Host "`n=== $text" -ForegroundColor Cyan }

# WHOSE ACCOUNT IS THIS? Right-click "Run as administrator" does not always
# elevate to the account you are logged in as. On this machine it elevates to a
# separate local admin, so $env:USERPROFILE here is NOT the profile holding the
# tunnel config or the Docker autostart entry. That cost one failed run; the
# script now prints it, and never reads $env:USERPROFILE again.
Write-Host ("running as: " + $env:USERNAME + "   (profile: " + $env:USERPROFILE + ")")

# ---------------------------------------------------------------- 1. tunnel
Say "cloudflared as a Windows service"

if (-not (Test-Path $cloudflared)) { throw "cloudflared not found at $cloudflared" }

# Found by looking, not by assuming. Exactly one config must exist across all
# profiles - two would mean two tunnels and a coin toss over which one starts.
$configs = @(Get-ChildItem "C:\Users" -Directory -ErrorAction SilentlyContinue |
  ForEach-Object { Join-Path $_.FullName ".cloudflared\config.yml" } |
  Where-Object { Test-Path $_ })

if ($configs.Count -eq 0) {
  throw "No .cloudflared\config.yml found under any profile in C:\Users. The tunnel has never been set up on this machine."
}
if ($configs.Count -gt 1) {
  throw ("More than one tunnel config found, so this script will not guess:`n  " + ($configs -join "`n  "))
}

$tunnelConfig = $configs[0]
Write-Host "tunnel config: $tunnelConfig"

# The service runs as LocalSystem and reads the credentials file named INSIDE
# that config. If it is missing, the service installs happily and then fails to
# connect every time, which is a much harder thing to diagnose later.
$credLine = (Select-String -Path $tunnelConfig -Pattern '^\s*credentials-file:\s*(.+)$' -ErrorAction SilentlyContinue |
  Select-Object -First 1)
if ($credLine) {
  $credPath = $credLine.Matches[0].Groups[1].Value.Trim()
  if (-not (Test-Path $credPath)) {
    throw "The config names a credentials file that does not exist: $credPath"
  }
  Write-Host "credentials:   present"
}

if (Get-Service cloudflared -ErrorAction SilentlyContinue) {
  Write-Host "service already exists - checking how it is wired"
} else {
  & $cloudflared --config $tunnelConfig service install
  if ($LASTEXITCODE -ne 0) {
    throw "cloudflared service install failed with exit code $LASTEXITCODE"
  }
}

# THE STEP THAT WAS MISSING, and it cost a whole evening.
#
# `cloudflared service install` does NOT record --config anywhere. The service
# it creates has an ImagePath of just the exe. With no config named, cloudflared
# looks in LocalSystem's own profile -
# C:\Windows\System32\config\systemprofile\.cloudflared\config.yml - which does
# not exist on this machine. So the service starts, finds no tunnel to run, does
# nothing at all, and reports Running.
#
# It reported Running for hours while the tunnel had ZERO connections and the
# dashboard said Down. Nothing surfaced it, because an unauthenticated request
# to erp.supserv-dz.com is answered by Cloudflare Access at the edge and never
# reaches the connector - so the public URL returns a healthy-looking 302 with
# the tunnel dead. Only a request that got PAST Access hit the origin, and that
# is the one that returned error 1033.
#
# Cloudflare's own Windows guide names the config in ImagePath. So do we.
# The config is read where it already lives rather than copied into the system
# profile: LocalSystem can read it there, and one file cannot drift out of sync
# with a copy of itself.
$svcKey  = "HKLM:\SYSTEM\CurrentControlSet\Services\cloudflared"
$wanted  = '"' + $cloudflared + '" --config="' + $tunnelConfig + '" tunnel run'
$current = (Get-ItemProperty $svcKey -ErrorAction SilentlyContinue).ImagePath

if ($current -ne $wanted) {
  Write-Host "service command line is wrong - fixing it"
  Write-Host "  was:  $current"
  Write-Host "  now:  $wanted"
  Set-ItemProperty -Path $svcKey -Name ImagePath -Value $wanted
} else {
  Write-Host "service command line already names the config"
}

Set-Service cloudflared -StartupType Automatic

# Restart it so the change takes effect. cloudflared does not always honour a
# stop request - it sat in StopPending indefinitely once - so the process is
# killed if it has not gone within fifteen seconds.
Say "restarting the tunnel"
Stop-Service cloudflared -ErrorAction SilentlyContinue
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Service cloudflared).Status -ne "Stopped" -and (Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 1
}
if ((Get-Service cloudflared).Status -ne "Stopped") {
  Write-Host "it would not stop - killing it"
  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 5
}
Start-Service cloudflared
Get-Service cloudflared | Format-Table Name, Status, StartType -AutoSize

# VERIFY AGAINST CLOUDFLARE, NOT AGAINST WINDOWS.
#
# "Running" means a process exists. It says nothing about whether the tunnel has
# a single connection, and believing it is precisely what went wrong. Ask
# Cloudflare how many connectors it can see instead.
Say "does Cloudflare actually see this tunnel?"

$tunnelId = $null
$idLine = (Select-String -Path $tunnelConfig -Pattern '^\s*tunnel:\s*(.+)$' -ErrorAction SilentlyContinue |
  Select-Object -First 1)
if ($idLine) { $tunnelId = $idLine.Matches[0].Groups[1].Value.Trim() }

$cert = Join-Path (Split-Path $tunnelConfig) "cert.pem"

if ($tunnelId -and (Test-Path $cert)) {
  Write-Host "waiting 20s for the connector to register..."
  Start-Sleep -Seconds 20
  $info = (& $cloudflared --origincert $cert tunnel info $tunnelId 2>&1 | Out-String)
  Write-Host $info
  if ($info -match "does not have any active connection") {
    Write-Warning "THE TUNNEL IS STILL DOWN. The service is running but is not connected."
    Write-Warning "Read the log named by 'logfile:' in $tunnelConfig, or add one."
  } else {
    Write-Host "tunnel is connected" -ForegroundColor Green
  }
} else {
  Write-Warning "Cannot verify: need both a 'tunnel:' line in the config and cert.pem beside it."
  Write-Warning "Check by hand:  cloudflared tunnel info <name>"
}

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
  # HKLM, not HKCU, and for the same reason as the tunnel config above: this
  # script is elevated, and on this machine that means a DIFFERENT account from
  # the one that actually logs in. An entry written to HKCU here would sit in
  # the admin account's hive, Docker would never start for the real user, and
  # nothing would say so - the ERP would just come up with no database after
  # every reboot. HKLM runs it for whoever logs in, which is what is wanted.
  New-ItemProperty -Path "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run" `
    -Name "Docker Desktop" -Value "`"$docker`" -Autostart" -PropertyType String -Force | Out-Null
  Write-Host "Docker Desktop will start when anybody logs in (HKLM)"

  # Clean up the wrong one if a previous run of this script left it behind.
  Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" `
    -Name "Docker Desktop" -ErrorAction SilentlyContinue
} else {
  Write-Warning "Docker Desktop not found at $docker - start it by hand or install it"
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
  Write-Host "automatic login is on - Docker Desktop will come back after a reboot"
}

Say "Done"
Write-Host "Check it with:  scripts\server\mode.ps1 status"
