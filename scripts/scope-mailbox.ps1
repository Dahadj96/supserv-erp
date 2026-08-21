<#
    Restrict the SUPSERV ERP application to ONE mailbox.

    Read docs/MAILBOX-ACCESS.md before running this. In short: the application
    permission already granted in Entra reaches every mailbox in the tenant,
    and this script replaces it with a scoped grant that reaches one.

    Requires the Exchange Administrator role, and:
        Install-Module ExchangeOnlineManagement -Scope CurrentUser

    Nothing here is destructive. It creates a scope, a pointer and a role
    assignment, and then tests them. Removing the old Entra consent is step 5
    and is done by hand in the portal, on purpose — see the end of this file.
#>

[CmdletBinding()]
param(
    # From .env — MS_CLIENT_ID. Not a secret.
    [string] $AppId = 'a6dcd142-9866-416f-ad89-c9f39e18d4c3',

    # The mailbox the ERP is allowed to read.
    [string] $Mailbox = 'contact@supserv.dz',

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
if (Get-ManagementScope -Identity $ScopeName -ErrorAction SilentlyContinue) {
    Write-Host "    '$ScopeName' already exists — leaving it alone."
} else {
    New-ManagementScope -Name $ScopeName `
        -RecipientRestrictionFilter "PrimarySmtpAddress -eq '$Mailbox'" | Out-Null
    Write-Host "    Created '$ScopeName' -> $Mailbox"
}

# Confirm the scope really does hold one mailbox and not, say, all of them.
$inScope = Get-Recipient -RecipientPreviewFilter "PrimarySmtpAddress -eq '$Mailbox'"
Write-Host "    Mailboxes matched by that filter: $($inScope.Count)"
if ($inScope.Count -ne 1) {
    throw "The filter matched $($inScope.Count) recipients. It must match exactly 1. Stopping."
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
New-ManagementRoleAssignment -App $EnterpriseAppObjectId `
    -Role 'Application Mail.Read' -CustomResourceScope $ScopeName | Out-Null
Write-Host "    Application Mail.Read -> $ScopeName"

Write-Host "`n=== 4. Proving the fence, in both directions ===" -ForegroundColor Cyan

Write-Host "`n    Should be allowed — $Mailbox" -ForegroundColor Green
$allowed = Test-ServicePrincipalAuthorization -Identity $AppId -Resource $Mailbox
$allowed | Format-Table RoleName, GrantedPermissions, AllowedResourceScope, InScope

Write-Host "    Should be DENIED — $MailboxThatMustBeDenied" -ForegroundColor Yellow
$denied = Test-ServicePrincipalAuthorization -Identity $AppId -Resource $MailboxThatMustBeDenied
$denied | Format-Table RoleName, GrantedPermissions, AllowedResourceScope, InScope

$ok = ($allowed | Where-Object { $_.InScope -eq $true }).Count -gt 0
$leak = ($denied | Where-Object { $_.InScope -eq $true }).Count -gt 0

Write-Host ""
if ($ok -and -not $leak) {
    Write-Host "PASS — the app reaches $Mailbox and not $MailboxThatMustBeDenied." -ForegroundColor Green
} elseif ($leak) {
    Write-Host "FAIL — the app can still reach $MailboxThatMustBeDenied. Do NOT continue." -ForegroundColor Red
    exit 1
} else {
    Write-Host "FAIL — the app cannot reach $Mailbox either. Check step 3." -ForegroundColor Red
    exit 1
}

Write-Host @"

=== 5. NOW REMOVE THE OLD CONSENT — this script cannot do it for you ===

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
