# The backup. Run nightly by a scheduled task; run by hand any time.
#
#     powershell -ExecutionPolicy Bypass -File scripts\server\backup.ps1
#
# WHY THIS SCRIPT VERIFIES ITSELF, at length, every single night:
#
# .env has said it since the day it was written - "a backup you have never
# restored is not a backup". A pg_dump that exits 0 proves the command ran. It
# does not prove the file can be read back, and every way of finding that out
# later is the expensive way. So this script dumps, then RESTORES the dump into
# a scratch database, then counts every row of every table on both sides and
# refuses to call the backup good unless the two agree exactly.
#
# That takes a couple of minutes on a database this size and it runs at 02:30
# while nobody is waiting for it. It is the cheapest verification there will
# ever be.
#
# WHAT IS NOT IN HERE, deliberately:
#
#   .env  - it holds MS_CLIENT_SECRET and the database password. A copy of it
#           on a USB drive in a drawer is a copy of the company's credentials
#           in a drawer. Restoring a machine means writing a new .env from
#           .env.example and the password manager. That is written up in
#           docs/RUNBOOK.md and it is a feature, not an omission.
#
#   .next - a build output. `pnpm build` reproduces it from the git history.

param(
  # Where to write. Overrides BACKUP_LOCAL_PATH from .env.
  [string]$To,

  # Skip the restore-and-compare. Prints a warning and marks the receipt
  # unverified, because an unverified backup must never look like a good one.
  [switch]$SkipVerify,

  # Keep this many days of daily backups, plus one per month for a year.
  [int]$KeepDays = 14
)

$ErrorActionPreference = "Stop"
$repo = "C:\SUPSERV-ERP"
$container = "supserv-db"
$dbUser = "supserv"
$dbName = "supserv"

# Never this one. It is the production database and nothing here may write to
# it - the whole script is a reader. Named so the check below can be read.
$SCRATCH = "supserv_restorecheck"

function Say($text) { Write-Host "`n=== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "FAILED: $text" -ForegroundColor Red; exit 1 }

# ------------------------------------------------------- read .env, honestly
# Only the two keys this script needs, and only from the file. Nothing here
# reads a secret, and nothing here prints one.
function EnvValue($name) {
  $line = Select-String -Path (Join-Path $repo ".env") -Pattern "^\s*$name\s*=\s*(.*)$" -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $line) { return "" }
  # Strip a trailing comment and surrounding whitespace. `#` inside a path is
  # not a thing on this machine and treating it as a comment is the safer read.
  return ($line.Matches[0].Groups[1].Value -replace '\s+#.*$', '').Trim()
}

# ------------------------------------------------------------- where to write
Say "destination"

$offsite = $true
$dest = $To
if (-not $dest) { $dest = EnvValue "BACKUP_LOCAL_PATH" }

# BACKUP_LOCAL_PATH was written when this was going to be a Linux VPS and still
# says /mnt/usb-backup. A POSIX path on Windows is not a destination, it is a
# leftover, and silently creating C:\mnt\usb-backup would be the worst possible
# outcome: a backup that looks configured, sits on the disk it is protecting,
# and nobody finds out until that disk is the thing that failed.
if ($dest -and ($dest.StartsWith("/") -or -not [System.IO.Path]::IsPathRooted($dest))) {
  Write-Warning "BACKUP_LOCAL_PATH is '$dest', which is not a Windows path. Ignoring it."
  $dest = ""
}
if ($dest -and -not (Test-Path (Split-Path -Qualifier $dest) -ErrorAction SilentlyContinue)) {
  Write-Warning "BACKUP_LOCAL_PATH points at drive $(Split-Path -Qualifier $dest), which is not plugged in."
  $dest = ""
}

if (-not $dest) {
  $dest = Join-Path $repo ".data\backups"
  $offsite = $false
  Write-Warning @"
THIS BACKUP IS ON THE SAME DISK AS THE DATA.

It protects against a mistake - a wrong delete, a bad import, a migration that
went sideways. It protects against NOTHING ELSE. A dead disk, a stolen machine
or a fire takes the ERP and every one of these backups together.

Plug in the external drive and set BACKUP_LOCAL_PATH in .env to its path, or
pass -To. Until then this line prints every night on purpose.
"@
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Write-Host "writing to: $dest"

# ---------------------------------------------------------------- the database
Say "is the database there"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail "docker is not on this account's PATH" }

docker exec $container pg_isready -U $dbUser 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "$container is not answering. Is Docker Desktop running? Is anybody logged in?" }

$startedAt = Get-Date
$stamp = $startedAt.ToString("yyyy-MM-dd-HHmm")
$dumpName = "supserv-$stamp.dump"
$dumpPath = Join-Path $dest $dumpName

Say "dumping $dbName"

# Dumped to a file INSIDE the container and copied out, rather than piped
# through this shell. PowerShell 5.1 puts a text encoder on the pipeline and a
# custom-format dump is binary - piping it produces a file of the right rough
# size that pg_restore cannot read. That is the failure this arrangement
# exists to avoid, and it is invisible until a restore is attempted.
docker exec $container sh -c "pg_dump -U $dbUser -d $dbName -Fc -f /tmp/$dumpName"
if ($LASTEXITCODE -ne 0) { Fail "pg_dump exited $LASTEXITCODE" }

docker cp "${container}:/tmp/$dumpName" $dumpPath
if ($LASTEXITCODE -ne 0) { Fail "could not copy the dump out of the container" }

$dumpBytes = (Get-Item $dumpPath).Length
Write-Host ("dump: {0}  ({1:N0} bytes)" -f $dumpName, $dumpBytes)

# A dump of nothing is a dump. Custom-format headers alone are a few hundred
# bytes, so anything this small means the database was empty or the dump was
# truncated, and either is worth stopping for.
if ($dumpBytes -lt 2048) { Fail "the dump is $dumpBytes bytes, which is not a database" }

# ------------------------------------------------------------------- verify
# The half that makes this a backup rather than a file.
$verified = $false
$tablesChecked = 0
$rowsChecked = 0

function RowCounts($database) {
  $out = docker exec $container psql -U $dbUser -d $database -At -F "|" -f /tmp/row-counts.sql 2>&1
  if ($LASTEXITCODE -ne 0) { Fail "counting rows in $database failed: $out" }
  return @($out | Where-Object { $_ -match '\|' })
}

if ($SkipVerify) {
  Write-Warning "-SkipVerify was passed. This backup has NOT been read back and is not known to be restorable."
} else {
  Say "restoring the dump into $SCRATCH and comparing every row"

  docker cp (Join-Path $repo "scripts\server\row-counts.sql") "${container}:/tmp/row-counts.sql" | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "could not copy row-counts.sql into the container" }

  $before = RowCounts $dbName

  # Dropped first, in case a previous run died halfway and left it. The name is
  # a constant at the top of this file and is never $dbName, which is the only
  # thing standing between a verification and an accident.
  if ($SCRATCH -eq $dbName) { Fail "the scratch database name equals the production one - refusing to run" }
  docker exec $container psql -U $dbUser -d postgres -c "drop database if exists $SCRATCH" | Out-Null
  docker exec $container psql -U $dbUser -d postgres -c "create database $SCRATCH" | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "could not create $SCRATCH" }

  # --exit-on-error, because pg_restore's default is to log a failure and carry
  # on, which produces a half-restored database and an exit code of 0. That is
  # precisely the shape of a verification that lies.
  $restore = docker exec $container pg_restore -U $dbUser -d $SCRATCH --exit-on-error "/tmp/$dumpName" 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host $restore
    Fail "THE DUMP DOES NOT RESTORE. The file written tonight is not a backup."
  }

  $after = RowCounts $SCRATCH

  # Compared as a whole rather than table by table, so a table that exists on
  # one side and not the other fails just as loudly as a wrong count. A restore
  # that silently dropped a table would otherwise pass every count it did make.
  $diff = Compare-Object $before $after
  if ($diff) {
    Write-Host "`nthese differ between the live database and the restored copy:" -ForegroundColor Red
    $diff | ForEach-Object { Write-Host ("  {0} {1}" -f $_.SideIndicator, $_.InputObject) }
    Fail "the restored copy does not match the database it came from"
  }

  $tablesChecked = $before.Count
  foreach ($row in $before) { $rowsChecked += [int64](($row -split '\|')[1]) }
  $verified = $true

  Write-Host ("verified: {0} tables, {1:N0} rows, all matching" -f $tablesChecked, $rowsChecked) -ForegroundColor Green

  # Left behind only if something above failed, which is when somebody would
  # want to look inside it.
  docker exec $container psql -U $dbUser -d postgres -c "drop database if exists $SCRATCH" | Out-Null
  docker exec $container rm -f "/tmp/$dumpName" | Out-Null
}

# --------------------------------------------------------------- the files
Say "working files"

# Where local.ts actually puts them, by the same rule local.ts uses: a POSIX
# path on Windows is not a path, so the project folder is where they are.
$storage = EnvValue "STORAGE_LOCAL_PATH"
if (-not $storage -or $storage.StartsWith("/") -or -not [System.IO.Path]::IsPathRooted($storage)) {
  $storage = Join-Path $repo ".data\files"
}

$filesName = "files-$stamp.zip"
$filesPath = Join-Path $dest $filesName
$filesBytes = 0

if (Test-Path $storage) {
  $count = @(Get-ChildItem $storage -Recurse -File -ErrorAction SilentlyContinue).Count
  if ($count -gt 0) {
    Compress-Archive -Path (Join-Path $storage "*") -DestinationPath $filesPath -Force
    $filesBytes = (Get-Item $filesPath).Length
    Write-Host ("files: {0} in {1}  ({2:N0} bytes)" -f $count, $filesName, $filesBytes)
  } else {
    Write-Host "no working files yet - nothing to archive"
  }
} else {
  Write-Host "no storage folder at $storage yet - nothing to archive"
}

# ------------------------------------------------------------- the receipt
# Written twice on purpose. The copy beside the backups is the record; the copy
# in .data is the one the ERP itself reads on screen 66, because that screen
# has to be able to say "the last backup was nine days ago" on a morning when
# the external drive is sitting in somebody's bag.
$receipt = [ordered]@{
  startedAt     = $startedAt.ToString("s")
  finishedAt    = (Get-Date).ToString("s")
  destination   = $dest
  offsite       = $offsite
  dump          = $dumpName
  dumpBytes     = $dumpBytes
  files         = if ($filesBytes -gt 0) { $filesName } else { $null }
  filesBytes    = $filesBytes
  verified      = $verified
  tablesChecked = $tablesChecked
  rowsChecked   = $rowsChecked
}

$json = $receipt | ConvertTo-Json
foreach ($where in @((Join-Path $dest "last-backup.json"), (Join-Path $repo ".data\last-backup.json"))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $where) | Out-Null
  # utf8 with no BOM would be better still, but 5.1 cannot write one and JSON
  # is ASCII here by construction.
  $json | Out-File -FilePath $where -Encoding utf8
}

# -------------------------------------------------------------- retention
Say "retention"

# Keep every backup from the last $KeepDays days, and the FIRST backup of each
# month for a year. A rule that only kept N most recent would mean a mistake
# nobody noticed for three weeks is a mistake with no good copy behind it.
$cutoff = (Get-Date).AddDays(-$KeepDays)
$yearAgo = (Get-Date).AddMonths(-12)
$all = @(Get-ChildItem $dest -File | Where-Object { $_.Name -match '^(supserv|files)-(\d{4}-\d{2}-\d{2})-\d{4}\.(dump|zip)$' })

$monthlyKeepers = @{}
foreach ($f in ($all | Sort-Object Name)) {
  $m = [regex]::Match($f.Name, '^(supserv|files)-(\d{4})-(\d{2})-\d{2}-\d{4}\.')
  # "supserv-2026-08" - the first dump of August and the first zip of August are
  # separate keepers, because a dump without its files is half a restore.
  $key = $m.Groups[1].Value + "-" + $m.Groups[2].Value + "-" + $m.Groups[3].Value
  if (-not $monthlyKeepers.ContainsKey($key)) { $monthlyKeepers[$key] = $f.Name }
}
$keepMonthly = [System.Collections.Generic.HashSet[string]]::new()
foreach ($name in $monthlyKeepers.Values) { [void]$keepMonthly.Add($name) }

$removed = 0
foreach ($f in $all) {
  if ($f.LastWriteTime -ge $cutoff) { continue }
  if ($keepMonthly.Contains($f.Name) -and $f.LastWriteTime -ge $yearAgo) { continue }
  Remove-Item $f.FullName -Force
  $removed++
}

$kept = @(Get-ChildItem $dest -File -Filter "supserv-*.dump")
Write-Host ("kept {0} dumps, removed {1} expired files" -f $kept.Count, $removed)

# ------------------------------------------------------------------ summary
Say "done"

Write-Host ("  database   {0}" -f $dumpName)
Write-Host ("  files      {0}" -f $(if ($filesBytes -gt 0) { $filesName } else { "none yet" }))
Write-Host ("  verified   {0}" -f $(if ($verified) { "yes - restored and every row compared" } else { "NO" }))
Write-Host ("  off this disk  {0}" -f $(if ($offsite) { "yes" } else { "NO" }))
Write-Host ("  took       {0:N0}s" -f ((Get-Date) - $startedAt).TotalSeconds)

if (-not $verified) { exit 2 }
