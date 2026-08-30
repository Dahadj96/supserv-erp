# The other half of scripts\server\backup.ps1.
#
# A backup script with no restore script is a promise nobody has read back. The
# night this is needed is the worst possible night to be writing it.
#
# THE DRILL - first Saturday of the month, five minutes, no risk:
#
#     powershell -ExecutionPolicy Bypass -File scripts\server\restore.ps1
#
# With no arguments it lists what exists, restores the newest dump into a
# scratch database, counts what came back, and drops nothing. It cannot touch
# the live database by accident; it takes an argument and a switch to do that,
# and it dumps the live one first even then.
#
# THE REAL THING - the machine is back, the database is empty or wrong:
#
#     powershell -ExecutionPolicy Bypass -File scripts\server\restore.ps1 `
#       -From supserv-2026-08-30-0230.dump -Into supserv -Force
#
# Stop the ERP first. See docs\RUNBOOK.md.

param(
  # A file name inside the backup folder, or a full path. Newest if omitted.
  [string]$From,

  # Which database to restore into. A scratch name by default.
  [string]$Into,

  # Required to write to the live database, and not sufficient on its own -
  # the script still refuses while the ERP is serving.
  [switch]$Force,

  # Where the backups are. Same resolution as backup.ps1.
  [string]$In
)

$ErrorActionPreference = "Stop"
$repo = "C:\SUPSERV-ERP"
$container = "supserv-db"
$dbUser = "supserv"
$LIVE = "supserv"

function Say($text) { Write-Host "`n=== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "FAILED: $text" -ForegroundColor Red; exit 1 }

function EnvValue($name) {
  $line = Select-String -Path (Join-Path $repo ".env") -Pattern "^\s*$name\s*=\s*(.*)$" -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $line) { return "" }
  return ($line.Matches[0].Groups[1].Value -replace '\s+#.*$', '').Trim()
}

# ------------------------------------------------------------ find the backups
$folder = $In
if (-not $folder) { $folder = EnvValue "BACKUP_LOCAL_PATH" }
if ($folder -and ($folder.StartsWith("/") -or -not [System.IO.Path]::IsPathRooted($folder))) { $folder = "" }
if (-not $folder -or -not (Test-Path $folder)) { $folder = Join-Path $repo ".data\backups" }
if (-not (Test-Path $folder)) { Fail "no backup folder at $folder - has backup.ps1 ever run?" }

Say "backups in $folder"

$dumps = @(Get-ChildItem $folder -File -Filter "supserv-*.dump" | Sort-Object Name -Descending)
if ($dumps.Count -eq 0) { Fail "no dumps in $folder" }

foreach ($d in $dumps | Select-Object -First 15) {
  Write-Host ("  {0}  {1,12:N0} bytes  {2}" -f $d.Name, $d.Length, $d.LastWriteTime.ToString("s"))
}
if ($dumps.Count -gt 15) { Write-Host ("  ... and {0} older" -f ($dumps.Count - 15)) }

$receipt = Join-Path $folder "last-backup.json"
if (Test-Path $receipt) {
  $r = Get-Content $receipt -Raw | ConvertFrom-Json
  $age = [int]((Get-Date) - [datetime]$r.finishedAt).TotalDays
  Write-Host ("`nlast backup: {0} ({1} days ago), verified: {2}" -f $r.finishedAt, $age, $r.verified)
}

# ------------------------------------------------------------- pick the dump
$dump = $null
if ($From) {
  $dump = if (Test-Path $From) { Get-Item $From } else { Get-Item (Join-Path $folder $From) -ErrorAction SilentlyContinue }
  if (-not $dump) { Fail "no such dump: $From" }
} else {
  $dump = $dumps[0]
  Write-Host "`nno -From given, using the newest"
}

# ------------------------------------------------------------ pick the target
$target = $Into
if (-not $target) {
  $target = "supserv_drill_" + (Get-Date).ToString("yyyyMMdd_HHmm")
  Write-Host "no -Into given, restoring into a scratch database: $target"
}

if ($target -eq $LIVE) {
  if (-not $Force) {
    Fail @"
-Into $LIVE overwrites the live database and -Force was not given.

If this is the drill, drop -Into and it will restore into a scratch copy.
If the machine has actually lost its data, stop the ERP and run it again with
-Force. It will dump whatever is in $LIVE first, so even a mistaken restore is
reversible.
"@
  }

  # A live server holding connections makes `drop database` fail halfway
  # through, which leaves the ERP pointed at a database that is being replaced.
  # Better to refuse than to find out in the middle.
  $listening = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
  if ($listening.Count -gt 0) {
    Fail "something is serving on port 3000. Stop the ERP first: Stop-ScheduledTask -TaskName 'SUPSERV ERP'"
  }

  Say "dumping the CURRENT $LIVE before replacing it"
  $safety = "before-restore-" + (Get-Date).ToString("yyyy-MM-dd-HHmm") + ".dump"
  docker exec $container sh -c "pg_dump -U $dbUser -d $LIVE -Fc -f /tmp/$safety"
  if ($LASTEXITCODE -ne 0) {
    Fail "could not dump the current database. Refusing to replace something that cannot be put back."
  }
  docker cp "${container}:/tmp/$safety" (Join-Path $folder $safety) | Out-Null
  Write-Host "kept as $safety" -ForegroundColor Green
}

# ------------------------------------------------------------------- restore
Say "restoring $($dump.Name) into $target"

docker cp $dump.FullName "${container}:/tmp/restore.dump" | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "could not copy the dump into the container" }

docker exec $container psql -U $dbUser -d postgres -c "drop database if exists $target" | Out-Null
docker exec $container psql -U $dbUser -d postgres -c "create database $target" | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "could not create $target" }

$out = docker exec $container pg_restore -U $dbUser -d $target --exit-on-error /tmp/restore.dump 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host $out
  Fail "pg_restore failed. This dump is not restorable - try the one before it, and read docs\RUNBOOK.md."
}

docker exec $container rm -f /tmp/restore.dump | Out-Null

# ---------------------------------------------------------------- what came back
Say "what came back"

docker cp (Join-Path $repo "scripts\server\row-counts.sql") "${container}:/tmp/row-counts.sql" | Out-Null
$counts = @(docker exec $container psql -U $dbUser -d $target -At -F "|" -f /tmp/row-counts.sql 2>&1 |
  Where-Object { $_ -match '\|' })

$total = 0
foreach ($row in $counts) { $total += [int64](($row -split '\|')[1]) }

# The tables somebody would actually look at to believe the restore. A row
# count of zero across all of these means the dump restored its schema and
# nothing else, which pg_restore reports as success.
#
# `party`, not `company`: a company and a supplier and a client are one record
# with roles hung off it, which is the whole point of party_role. The first
# version of this list asked for a `company` table and silently printed nothing.
foreach ($name in @("party", "deal", "document", "item", "payment", "audit_entry")) {
  $row = $counts | Where-Object { $_ -like "$name|*" } | Select-Object -First 1
  if ($row) { Write-Host ("  {0,-14} {1}" -f $name, ($row -split '\|')[1]) }
}
Write-Host ("`n{0} tables, {1:N0} rows in {2}" -f $counts.Count, $total, $target)

if ($target -eq $LIVE) {
  Say "the working files"
  Write-Host @"
The database is back. The FILES are not - they are a separate archive.

  1. find files-<same stamp>.zip in $folder
  2. expand it into the storage folder (.data\files unless STORAGE_LOCAL_PATH
     names a real Windows path)
  3. open /settings/storage in the ERP: it lists every file a record points at
     and cannot find. That screen is how you know the two halves match.

Then start the ERP:  Start-ScheduledTask -TaskName 'SUPSERV ERP'
"@
} else {
  Say "the drill is done"
  Write-Host @"
$target is a copy. Nothing live was touched.

Look inside it if you want:
  docker exec -it $container psql -U $dbUser -d $target

Drop it when finished:
  docker exec $container psql -U $dbUser -d postgres -c "drop database $target"
"@
}
