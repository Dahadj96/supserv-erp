# Who sees cost and margin — OPEN, needs the Gérant

**Screens 11 and 12. 2026-08-26.**

**This is not a decision I made. It is a contradiction I found, implemented the
only safe way, and am handing over.**

## The contradiction

Screen 12's banner says:

> Cost and margin columns are visible because you are signed in as Gérant.
> **The Commercial role sees selling price only.**

`src/auth/can.ts` says something else:

```ts
commercial: ["offers.margin.view", "offers.issue", "merge.execute"],
compta:     ["offers.margin.view", "invoices.issue", ...],
```

Both `commercial` and `compta` hold `offers.margin.view`. By the permission
table, a Commercial sees cost and margin. By the screen, they do not.

## What was built

**The screens follow `can()`.** The permission table is the one place that
question is answered, and a second answer hardcoded into a page is exactly how
two answers come to disagree — the same reasoning that keeps `stage` out of the
`deal` table.

Three consequences, so the behaviour is not surprising:

1. The banner's wording is derived, not written. It says "your role (X) has
   permission to see them" or "your role (X) sees selling prices only" — it
   never names a role it has not checked.
2. The Offers list hides the margin column under the same permission. A list
   that shows a figure the detail screen hides is worse than either choice.
3. Setting a price FROM a margin requires `offers.margin.view`, in the server
   action as well as the page. A screen that hides the cost column while letting
   somebody reprice against it would be lying about what it is doing.

## The question for the Gérant

**Should `commercial` keep `offers.margin.view`?**

The argument for the mockup's version: a Commercial negotiates. Someone who can
see the cost floor can discount to it, and in a firm this size margin
visibility is the Gérant's. The argument for the table as it stands: a
Commercial who cannot see margin cannot tell a good deal from a bad one, and
will call the Gérant about every line.

There is no technically correct answer. It is a question about how this company
runs, and changing it is one line:

```ts
commercial: ["offers.issue", "merge.execute"],
```

`compta` is a separate question with a likely different answer — the accountant
needs margin for the books and never negotiates.

## Why it was not simply changed

Removing a permission changes what a colleague can see in their job. The
compliance profile exists precisely to stop this system inventing rules nobody
confirmed (`src/domain/compliance-profile.ts`), and "the Commercial should not
see margin" is a rule about this company that only its Gérant can confirm.
A mockup is evidence of an intention, not a confirmation of one.
