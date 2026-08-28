# Entra ID is the way in to the ERP

Date: 2026-08-28
Status: in force (Cloudflare one-time-PIN kept as a fallback for now)

## The problem

Cloudflare Access sat in front of `erp.supserv-dz.com` with one login
method -- Cloudflare's own one-time PIN -- and one policy rule:

    Include / Emails / dahadjabderrahman@gmail.com

That is one personal Gmail address. Nobody at SUPSERV could reach the ERP
except through the gerant's private mailbox, and every sign-in meant
copying a code out of an email. It also meant the identity Access knew
about had nothing to do with the identity the ERP knows about: the ERP's
people are `@supserv.dz` accounts in Entra.

## The decision

Cloudflare Access authenticates against Microsoft Entra ID, the same
directory the ERP already trusts for mail and for Better Auth.

Entra side -- app registration **Cloudflare Access**, single tenant:

- Application (client) ID `00f3da7b-8d80-4f93-b3c0-9a248c136e0a`
- Directory (tenant) ID `88896bb6-758c-4414-a53d-90fdc19abf35`
- Redirect URI `https://red-salad-e41e.cloudflareaccess.com/cdn-cgi/access/callback`
- Delegated Graph permissions, all admin-consented:
  `openid`, `profile`, `email`, `offline_access`, `User.Read`,
  `Directory.Read.All`, `GroupMember.Read.All`

The client secret was created by the gerant and pasted into Cloudflare by
him. It is not in this repository, not in `.env`, and has never been in a
chat transcript -- same rule as `MS_CLIENT_SECRET`.

Cloudflare side:

- Integrations -> Identity providers -> **Microsoft Entra ID**, with
  Support Groups on. Its **Test** returns the signed-in user's name,
  `@supserv.dz` address, `amr: [pwd, mfa]` and their Entra group list.
- Application **SUPSERV ERP** -> Login methods -> *Accept all available
  identity providers* stays **on**, so both Entra and the Cloudflare PIN
  are offered.
- Policy **SUPSERV people** now has two OR'd includes:
    - Emails: `dahadjabderrahman@gmail.com`
    - Emails ending in: `@supserv.dz`

## Why the policy was widened before the login method was changed

A Cloudflare Access policy is evaluated *after* the identity provider has
authenticated someone. Entra can only ever return an `@supserv.dz`
address; it can never return a Gmail one. So switching the login method
over while the policy still listed only the Gmail address would have
authenticated the gerant correctly and then denied him -- locking the
only administrator out of the ERP, with the Cloudflare dashboard as the
sole way back in.

Widen, verify, then narrow. Never the other way round.

## What is deliberately still in place

- **The Gmail address in the policy.** It is the way back in if the Entra
  client secret lapses or the app registration is broken. Remove it only
  after Entra sign-in has been used for a while.
- **The Cloudflare one-time PIN as a login method.** Same reason.
- **A 24 hour session duration.** Worth raising once sign-in is no longer
  a code-in-an-email chore, but that is a separate change.

## MFA

Entra carries the MFA claim through (`amr: [pwd, mfa]`), so the ERP is
now behind the same second factor as the mailbox. The Cloudflare PIN
method carries no such claim -- which is the strongest argument for
removing it once Entra has proven itself.

## The thing that will bite

**The Entra client secret expires.** When it does, nobody can sign in and
the error will not say why. Write the expiry date in the runbook and set
a reminder a month before it.
