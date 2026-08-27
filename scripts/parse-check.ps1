# Parses each server script WITHOUT running it, so a syntax error is found here
# and not halfway through creating a Windows service.
$ok = $true
foreach ($f in Get-ChildItem "$PSScriptRoot\server\*.ps1") {
  $errors = $null
  $null = [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$null, [ref]$errors)
  if ($errors -and $errors.Count -gt 0) {
    $ok = $false
    Write-Host ("FAIL  " + $f.Name) -ForegroundColor Red
    foreach ($e in $errors) {
      Write-Host ("      line " + $e.Extent.StartLineNumber + ": " + $e.Message)
    }
  } else {
    Write-Host ("OK    " + $f.Name) -ForegroundColor Green
  }
}
if (-not $ok) { exit 1 }
