# Self-hosted on a VPS with Dokploy

**Date:** 2026-08-19 · **Decided by:** A. Dahadj · **Status:** accepted

## Context

Version 3 of the plan assumed Supabase and Vercel. Paying foreign SaaS monthly
from Algeria is not reliably possible, and SUPSERV wants the option of moving the
whole system onto a server in their own office later.

## Decision

One VPS running Dokploy. Postgres, the Next.js app, a pg-boss worker and a
Playwright renderer as containers, behind Traefik with automatic TLS.

## Consequences

- **Supabase is out**, so there is no RLS convenience layer. Authorisation goes
  through one `can()` choke point in `src/auth/can.ts`. Postgres RLS is added
  later as defence in depth on `document`, `payment` and `person`.
- **Better Auth** replaces Supabase Auth, with Microsoft Entra ID as the provider
  (the M365 accounts already exist) and email + password for anyone without a
  licence.
- **pg-boss** replaces any hosted queue. It runs inside the database we already
  have — no Redis, no second service, no second bill.
- **Search is Postgres** — `tsvector` + `pg_trgm` + `unaccent`. No Meilisearch.
- **MinIO is not used.** It is archived. Working files go on a volume behind the
  `Storage` interface; final documents go to SharePoint via Graph.
- Backups become our responsibility. Dokploy backs Postgres up nightly to an
  off-site S3 bucket, and that is configured on day one, before there is data.

## Reversible?

Yes, and cheaply. The app is a standard Docker image. Moving to a managed host
later means pointing a different platform at the same repository.
