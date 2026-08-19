# The ERP runs on a mini PC in the office, not a VPS

**Date:** 2026-08-19 · **Decided by:** A. Dahadj · **Status:** accepted
**Supersedes:** the VPS decision of the same day

## Context

A used mini PC (8–16 GB RAM, Intel 8th–10th gen) costs less than one year of any
VPS — Algerian or foreign — and SUPSERV already has a ThinkCentre mini, 1 Gbps
office fibre, and Microsoft 365. The office line is residential: dynamic public
IP, possibly CGNAT.

## Decision

Production runs on a dedicated mini PC in the Adrar office: Ubuntu Server 24.04
LTS + Docker + Dokploy. Access is via Tailscale, not a public IP.

## Why, beyond the price

When the fibre drops, an office server keeps serving the office. A VPS does not.
Client documents never leave the premises. There is no foreign card to fail.

## Consequences

- **Backups become entirely SUPSERV's responsibility.** Nightly encrypted
  Postgres dump to SharePoint (already paid for) plus a local USB SSD, with a
  monthly restore test. This is the single largest new risk.
- **No public IP is needed.** Tailscale (free, ≤6 users) gives a stable name and
  real Let's Encrypt HTTPS for `*.ts.net`, works behind CGNAT, opens no ports,
  and connects directly over the LAN when devices are in the office.
- **supserv.dz is not touched.** Cloudflare Tunnel would require moving the whole
  domain's nameservers on the free plan, which would move the Microsoft 365 MX
  records. Not worth the risk.
- **Screen 46 needs no public endpoint.** The website form emails the shared
  mailbox; the Inbox already reads it.
- **The current ThinkCentre is for development only.** It browses the web and
  reads email, so it must not hold the production database.
- Off-site backup target changes from an S3 bucket to SharePoint.
- Tailscale's free tier caps at 6 users. Headscale, self-hosted on the same
  machine, removes the cap for free if SUPSERV grows.

## Reversible?

Entirely. `docker-compose.yml` is unchanged and deploys to any rented server in
an afternoon.
