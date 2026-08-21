# Facts and rules on the "Before issuing" checklist

**Screen 18. 2026-08-21.**

Screen 18 draws ten rows under "Before issuing", one red, two amber, seven
green. Building it forced a distinction the design does not draw, and getting it
wrong in either direction is a real failure.

## The two kinds of row

A **rule** row comes from `compliance.check()`. It has an authority, the name of
whoever confirmed it and the date they did, and it is the only kind of row that
can refuse an issue. `invoice.clientNifMissing` is one: the décret exécutif
05-468 requires the buyer's NIF on an invoice, the decree confirmed itself, and
so the row is red and the Issue button is grey.

A **fact** row is `checklist.ts` reading the rendered document and reporting what
will be printed. It never blocks. When the value is absent it says *not
recorded — nothing will be printed*. It does not say *missing*, and it does not
say *required*.

`clientNis`, `clientRc`, `clientAddress`, `amountInWords` and `documentNumber`
are facts. If the client's NIS is blank, the checklist reports a blank field and
the summary still reads "no blocker, no warning".

## Why the difference is not cosmetic

The mockup shows "Client NIS" with a green check and a number. It is silent on
what the row looks like when the number is absent, and the obvious choice —
colour it red like the NIF above it — would have the system asserting that
Algerian law requires the buyer's NIS on an invoice. Nobody has told it that.
Under the hard rule (*nothing is a fact until a person confirms it*) that
assertion is not ours to make, and it is the kind of mistake that is invisible
until an inspector disagrees.

So the rule table decides which rows can be red, and only screen 69 writes to the
rule table. The day somebody confirms "the buyer's NIS is obligatory", it appears
here as a rule row, red, with their name on it — and no code changes.

`tests/unit/checklist.test.ts` holds that line: *"says a missing fact is not
recorded — it does not call it required"*.

## The two rows we did not build

The mockup's row 7 is "TVA rate · 19% — confirm 9% does not apply" (amber) and
row 9 is "Situation n°3 approved by client · still waiting 21 days" (amber).
Neither exists yet:

- **The TVA row** needs a rule that says which rate applies to which sale. That
  is one of the four questions waiting on the accountant. `invoice.vatServicesAbroad`
  is the nearest rule we have and it is not the same question. Inventing
  `invoice.vatRateChoice` and having it warn would put a made-up rule on screen
  wearing the same clothes as the décret.
- **The approval row** needs the marchés / situations module (phase 5). There is
  no `situation` record to be waiting on.

Both will slot in without touching this file: the first as a rule row once the
rule is written down and confirmed, the second as a fact row over data that
exists. Until then the checklist reports eight rows, not ten, and says so
honestly rather than padding itself to match a picture.

## An unresolved duplication

`src/domain/rules.ts` holds a second, older rule model with snake_case codes and
a `SEED_RULES` constant whose entries claim `confirmedBy: "A. Dahadj",
confirmedOn: "2026-08-01"` — a confirmation nobody gave. It is used in exactly
one place, the demo popover on the deals page, and it gates nothing. It should be
deleted and the popover pointed at `blocking_rule` in the database, so there is
one answer to "may I issue this" and no fabricated signature anywhere in the
tree. Not done here to keep this change to one screen.
