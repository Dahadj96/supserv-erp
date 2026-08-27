# Letting the ERP read one mailbox — and only one

**Status: not done yet. The ERP refuses to call Graph until it is.**

## The problem, stated plainly

`Mail.Read` granted as an **application permission** in Entra ID is not
permission to read `contact@supserv.dz`. It is permission to read **every
mailbox in the tenant** — the Gérant's, the accountant's, everyone's — with no
further consent, no prompt, and nothing in anyone's inbox to show it happened.

Microsoft says this outright:

> By default, apps that have been granted application permissions to the
> following data sets can access all the mailboxes in the organization:
> Calendars, Contacts, Mail, Mailbox settings.

An ERP for six people does not need that, and should never have it.

## The correct fix, as of 2026

**RBAC for Applications**, in Exchange Online. It grants a role to the
application *paired with a resource scope* — a filter that names which mailboxes
the role applies to.

> **Not Application Access Policies.** `New-ApplicationAccessPolicy` is the
> answer you will find in most blog posts and it still works, but Microsoft has
> marked it legacy: *"Don't create new App Access Policies as these policies
> will eventually require migration to Role Based Access Control for
> Applications."* We are configuring this for the first time, so we configure it
> the way it will still be configured in three years.

The two systems are **additive**, which is the part that catches people:

> if your Service Principal has `Mail.Read` granted in Microsoft Entra ID and
> you configure a resource-scoped `Mail.Read` permission in Application RBAC,
> it's important that you remove the assignment of `Mail.Read` from Microsoft
> Entra ID. Otherwise, the union … results in **no effective resource scoping**.

So the Entra consent that has already been granted is not the goal — it is the
thing that has to come **off** at the end. Leaving it on makes the whole exercise
decorative.

## What you need before you start

### 1. The role — check before assigning

**Whoever bought the Microsoft 365 subscription is Global Administrator by
default**, and Microsoft's own documentation says the Global Administrator and
Exchange Administrator roles "provide the required permissions for any task in
Exchange Online PowerShell". So this is usually a check, not a change.

Check: [admin.microsoft.com](https://admin.microsoft.com) → **Users → Active
users** → click yourself → look under **Roles**.

- Says **Global Administrator** → nothing to do.
- Says anything else → **Roles → Role assignments → Exchange** tab → **Exchange
  Administrator** → **Assigned** → **Add users**. Allow a few minutes; role
  changes are not instant.

### 2. The Object ID of the enterprise application

Not the App ID, and **not the Object ID on the App registrations page** — that
one belongs to the *application object*, and Exchange will reject it. The one
needed belongs to the *service principal*, which is the tenant-local half.

The route that cannot pick the wrong one:

1. [entra.microsoft.com](https://entra.microsoft.com) → **Applications → App
   registrations → All applications → SUPSERV ERP**.
2. On the Overview page, in **Essentials**, click the link labelled **"Managed
   application in local directory"**.
3. That lands on the **Enterprise application** page. Copy the **Object ID**
   shown there.

Or without the portal at all:

```powershell
Install-Module Microsoft.Graph -Scope CurrentUser
Connect-MgGraph -Scopes "Application.Read.All"
(Get-MgServicePrincipal -Filter "appId eq 'a6dcd142-9866-416f-ad89-c9f39e18d4c3'").Id
```

**Sanity check:** it must not equal `a6dcd142-9866-416f-ad89-c9f39e18d4c3` (that
is the Application/Client ID) and must not equal the Object ID printed on the
App registrations page. If it matches either, it is the wrong value.

It is not a secret. Tenant ID, client ID and this Object ID are all identifiers,
not credentials. `MS_CLIENT_SECRET` is the credential, and it never leaves
`.env`.

### 3. The module

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser
Connect-ExchangeOnline -UserPrincipalName <your admin address>
```

## The steps

`scripts/scope-mailbox.ps1` runs 1 to 5. Read it before running it.

1. **A scope containing exactly one mailbox.**

   ```powershell
   New-ManagementScope -Name "SUPSERV ERP mailbox" `
     -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'contact@supserv.dz'"
   ```

2. **A pointer in Exchange to the Entra service principal.** Exchange cannot
   create service principals; this is a reference to the one Entra already has.

   ```powershell
   New-ServicePrincipal -AppId <MS_CLIENT_ID> -ObjectId <enterprise app Object ID> `
     -DisplayName "SUPSERV ERP"
   ```

3. **The role, scoped.** `Application Mail.Read` is all the ERP does today — it
   reads. Add `Application Mail.ReadWrite` only when it starts marking messages
   as read in the mailbox itself.

   ```powershell
   New-ManagementRoleAssignment -App <enterprise app Object ID> `
     -Role "Application Mail.Read" -CustomResourceScope "SUPSERV ERP mailbox"
   ```

4. **Prove the fence exists, in both directions.** This is the step nobody does,
   and it is the only one that actually tells you anything.

   ```powershell
   Test-ServicePrincipalAuthorization -Identity <MS_CLIENT_ID> -Resource contact@supserv.dz | Format-Table
   Test-ServicePrincipalAuthorization -Identity <MS_CLIENT_ID> -Resource <your own address> | Format-Table
   ```

   The first must show `InScope: True`. The second must show `InScope: False`.
   A pass on the first alone proves nothing — an unrestricted app passes it too.

5. **Remove the Entra consent.** Entra admin centre → App registrations → the
   ERP app → **API permissions** → remove `Mail.Read` and `Mail.ReadWrite` from
   **Application permissions**, then **Grant admin consent** again to apply the
   removal.

   Until this is done, the app still has org-wide access and step 4 was theatre.

6. **Tell the ERP.** In `.env`:

   ```
   MS_MAILBOX_SCOPE_CONFIRMED=true
   ```

   Then restart it, and press **Sync now** on the Inbox.

## If step 6 fails with 403

Permission changes are cached for **30 minutes to 2 hours** depending on how
recently the app called Graph. `Test-ServicePrincipalAuthorization` bypasses that
cache, which is why step 4 can pass while step 6 still fails. Wait, then retry.

If it still fails after two hours, the likely cause is step 5: removing the Entra
consent removed the app's only Graph grant, and the RBAC assignment did not take.
Re-check step 3 with:

```powershell
Get-ManagementRoleAssignment -App <enterprise app Object ID> | Format-List Name,Role,CustomResourceScope
```

## Why the ERP refuses to run without this

`src/capture/mail/graph.ts` will not make a single HTTP request while
`MS_MAILBOX_SCOPE_CONFIRMED` is anything other than `true`. A boolean somebody
has to type is a weak lock — but it cannot be opened by *forgetting*, and
forgetting is how this particular mistake happens.

## Sources

- [Role Based Access Control for Applications in Exchange Online](https://learn.microsoft.com/exchange/permissions-exo/application-rbac)
- [Application Access Policies (legacy)](https://learn.microsoft.com/exchange/permissions-exo/application-access-policies)
