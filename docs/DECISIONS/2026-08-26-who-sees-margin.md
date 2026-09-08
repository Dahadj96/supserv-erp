# Who sees cost and margin — RESOLVED

**Screens 11 and 12. Opened 2026-08-26; resolved 2026-09-08.**

## Decision

The Figma screen is the source of truth: the Commercial role sees selling
prices, but not supplier cost or margin. The Gérant and Compta retain
`offers.margin.view`.

Commercial users can still enter a selling price and issue an offer. They cannot
apply a margin percentage, because doing so requires reading the cost from which
that price is derived. The server actions enforce both parts independently.

This resolves the earlier contradiction between screen 12 and `src/auth/can.ts`.
The list, builder, banner, and server actions all read the same permission, so
the decision has one implementation.
