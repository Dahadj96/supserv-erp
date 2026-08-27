<#
    Restrict the SUPSERV ERP application to ONE mailbox.

    Read docs/MAILBOX-ACCESS.md before running this. In short: the application
    permission already granted in Entra reaches every mailbox in the tenant,
    and this script replaces it with a scoped grant that reaches one.

    Requires the Exchange Administrator role, and:
        Install-Module ExchangeOnlineManagement -Scope CurrentUser

    Nothing here is destructive. It creates a scope, a pointer and a role
    assignment, and then tests them. Removing the old Entra consent is step 5
    and is done by hand in the portal, on purpose - see the end of this file.
#>

[CmdletBinding()]
param(
    # From .env - MS_CLIENT_ID. Not a secret.
    [string] $AppId = 'a6dcd142-9866-416f-ad89-c9f39e18d4c3',

    # The mailbox the ERP is allowed to read.
    #
    # supserv-dz.com, not supserv.dz. The tenant has both, and they are not
    # interchangeable: people are on supserv.dz (abderrahmane.dahadj@, admin@,
    # commercial@, recrutement@) and the shared addresses are on supserv-dz.com
    # (contact@, info@, Supserv@, allcompany@). This said supserv.dz for a
    # while, which matches nothing, and the run failed at the recipient check.
    [string] $Mailbox = 'contact@supserv-dz.com',

    # A mailbox it must NOT be able to read. Use your own address.
    # Testing only the allowed one proves nothing: an unrestricted app passes.
    [Parameter(Mandatory = $true)]
    [string] $MailboxThatMustBeDenied,

    # Entra admin centre -> Enterprise applications -> the app -> Object ID.
    # NOT the Object ID shown on the App registrations page; that is a
    # different object and New-ServicePrincipal will reject it.
    [Parameter(Mandatory = $true)]
    [string] $EnterpriseAppObjectId,

    [string] $ScopeName = 'SUPSERV ERP mailbox'
)

$ErrorActionPreference = 'Stop'

Write-Host "`n=== Connecting to Exchange Online ===" -ForegroundColor Cyan
Connect-ExchangeOnline -ShowBanner:$false

Write-Host "`n=== 1. A scope holding exactly one mailbox ===" -ForegroundColor Cyan

# The mailbox is checked BEFORE the scope is created, not after.
#
# It was the other way round for one run, and that run created a scope pointing
# at an address no mailbox has - then stopped. Re-running would have found the
# scope, said "already exists - leaving it alone", and carried on granting a
# role against a filter matching nothing. A check that runs after the change it
# is checking has already been made is not a check.
#
# @() around it on purpose. Get-Recipient returns nothing at all when the filter
# matches nothing, and $null.Count is $null - so the count printed as blank and
# the error read "The filter matched  recipients", which says less than it
# should about the one thing that went wrong.
$inScope = @(Get-Recipient -RecipientPreviewFilter "PrimarySmtpAddress -eq '$Mailbox'" -ErrorAction SilentlyContinue)
Write-Host "    Mailboxes matched by that filter: $($inScope.Count)"

if ($inScope.Count -eq 0) {
    Write-Host ""
    Write-Host "    Nothing in this tenant has $Mailbox as its PRIMARY address." -ForegroundColor Yellow
    Write-Host "    It may not exist, or it may be an alias on some other mailbox." -ForegroundColor Yellow
    Write-Host "    A scope filtered on PrimarySmtpAddress does not match an alias." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    What this tenant actually has:" -ForegroundColor Cyan
    Get-Recipient -ResultSize 100 |
        Select-Object DisplayName, PrimarySmtpAddress, RecipientTypeDetails |
        Format-Table -AutoSize |
        Out-String |
        Write-Host
    throw "No mailbox has $Mailbox as its primary address. Re-run with -Mailbox <the address listed above>."
}

if ($inScope.Count -ne 1) {
    $inScope | Select-Object DisplayName, PrimarySmtpAddress | Format-Table -AutoSize | Out-String | Write-Host
    throw "The filter matched $($inScope.Count) recipients. It must match exactly 1. Stopping."
}

Write-Host "    $($inScope[0].DisplayName) <$($inScope[0].PrimarySmtpAddress)>"

# Only now is anything created. And an existing scope is checked rather than
# trusted - one left behind by a failed run points somewhere else, and silently
# reusing it would scope the grant to the wrong mailbox, or to none.
$existing = Get-ManagementScope -Identity $ScopeName -ErrorAction SilentlyContinue
if ($existing) {
    if ($existing.RecipientFilter -notlike "*$Mailbox*") {
        Write-Host "    Existing filter: $($existing.RecipientFilter)" -ForegroundColor Yellow
        throw ("A scope named '$ScopeName' already exists and does not name $Mailbox. " +
            "Remove it with:  Remove-ManagementScope -Identity '$ScopeName'")
    }
    Write-Host "    '$ScopeName' already exists and names the right mailbox."
} else {
    New-ManagementScope -Name $ScopeName `
        -RecipientRestrictionFilter "PrimarySmtpAddress -eq '$Mailbox'" | Out-Null
    Write-Host "    Created '$ScopeName' -> $Mailbox"
}

Write-Host "`n=== 2. Pointing Exchange at the Entra service principal ===" -ForegroundColor Cyan
if (Get-ServicePrincipal -Identity $AppId -ErrorAction SilentlyContinue) {
    Write-Host "    Already registered in Exchange."
} else {
    New-ServicePrincipal -AppId $AppId -ObjectId $EnterpriseAppObjectId `
        -DisplayName 'SUPSERV ERP' | Out-Null
    Write-Host "    Registered."
}

Write-Host "`n=== 3. Granting Mail.Read, scoped ===" -ForegroundColor Cyan
# Read only. The ERP does not send, reply, or modify anything in the mailbox.
# Add 'Application Mail.ReadWrite' the day it starts marking messages as read.
# Idempotent, because this script gets re-run and an unconditional
# New-ManagementRoleAssignment adds a second identical grant each time.
#
# -RoleAssigneeType, not -App. `New-ManagementRoleAssignment` takes -App;
# `Get-ManagementRoleAssignment` does not have that parameter at all, and
# assuming the pair matched cost a run. The two cmdlets are not symmetrical.
$assigned = @(Get-ManagementRoleAssignment -RoleAssigneeType ServicePrincipal -ErrorAction SilentlyContinue |
    Where-Object { $_.Role -like '*Mail.Read*' })

if ($assigned.Count -gt 0) {
    Write-Host "    Already granted. What exists now:"
    # Format-List, not Format-Table. The assignment name is 58 characters and
    # the table put the last column header down the screen one letter per line.
    $assigned |
        Select-Object Name, Role, RoleAssigneeName, CustomResourceScope |
        Format-List |
        Out-String |
        Write-Host
} else {
    New-ManagementRoleAssignment -App $EnterpriseAppObjectId `
        -Role 'Application Mail.Read' -CustomResourceScope $ScopeName | Out-Null
    Write-Host "    Application Mail.Read -> $ScopeName"
}

Write-Host "`n=== 4. Proving the fence, in both directions ===" -ForegroundColor Cyan

Write-Host "`n    Should be allowed - $Mailbox" -ForegroundColor Green
$allowed = Test-ServicePrincipalAuthorization -Identity $AppId -Resource $Mailbox
$allowed | Format-Table RoleName, GrantedPermissions, AllowedResourceScope, InScope

Write-Host "    Should be DENIED - $MailboxThatMustBeDenied" -ForegroundColor Yellow
$denied = Test-ServicePrincipalAuthorization -Identity $AppId -Resource $MailboxThatMustBeDenied
$denied | Format-Table RoleName, GrantedPermissions, AllowedResourceScope, InScope

# Compared as text, and wrapped in @().
#
# The first version read `$_.InScope -eq $true` and called a correct result a
# FAIL: the tables above printed True and False exactly as they should, and the
# verdict line still said the app could not reach its own mailbox. Whatever
# Test-ServicePrincipalAuthorization puts in that property, it does not compare
# equal to $true. Its printed form is the thing being asserted about, so that is
# what gets compared - and @() keeps .Count meaningful when one row comes back
# instead of several.
#
# Worth stating plainly: a verifier that cries wolf is worse than no verifier.
# This one was about to send somebody to re-check a step that was already right.
$ok = @($allowed | Where-Object { "$($_.InScope)" -eq 'True' }).Count -gt 0
$leak = @($denied | Where-Object { "$($_.InScope)" -eq 'True' }).Count -gt 0

Write-Host ""
if ($ok -and -not $leak) {
    Write-Host "PASS - the app reaches $Mailbox and not $MailboxThatMustBeDenied." -ForegroundColor Green
} elseif ($leak) {
    Write-Host "FAIL - the app can still reach $MailboxThatMustBeDenied. Do NOT continue." -ForegroundColor Red
    exit 1
} else {
    Write-Host "FAIL - the app cannot reach $Mailbox either. Check step 3." -ForegroundColor Red
    exit 1
}

Write-Host @"

=== 5. NOW REMOVE THE OLD CONSENT - this script cannot do it for you ===

Entra admin centre -> App registrations -> SUPSERV ERP -> API permissions
  - remove Mail.Read and Mail.ReadWrite from APPLICATION permissions
  - then press "Grant admin consent" again to apply the removal

Until that is done the app STILL has organisation-wide access, because Entra
grants and Exchange RBAC grants are added together, not intersected. Step 4
above passing does not change that.

=== 6. Then tell the ERP ===

In .env:      MS_MAILBOX_SCOPE_CONFIRMED=true
Restart it, and press "Sync now" on the Inbox.

A 403 in the first two hours is the permission cache, not a mistake. Wait and
retry. See docs/MAILBOX-ACCESS.md.

"@ -ForegroundColor Cyan

Disconnect-ExchangeOnline -Confirm:$false
