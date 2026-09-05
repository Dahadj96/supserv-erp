# A man's tickets

**Date:** 5 September 2026
**Status:** built — screen 25 can write a certification, and check one

## What was wrong

`person_certification` was read in four places:

- screen 25's table, which is the substance of that page;
- screen 51's list, which puts each person's soonest-expiring ticket on their
  row;
- screen 24/26's headcount, which stops counting a confirmed welder whose
  habilitation lapses before the start date;
- screen 16's crew panel, which is how a site decides whether a man may work
  tomorrow.

There was no insert anywhere in `src/`. The only writes in the repository were
in test fixtures. Four screens read a table that nothing could fill, and the
company's welders had habilitations with nowhere to type them.

Worse in kind: `is_verified boolean not null default false` was rendered as a
badge on screen 25 — "Contrôlée" / "Non contrôlée" — and nothing anywhere could
set it. Every ticket in the company read *Non contrôlée* for ever, which makes
the badge worse than no badge: a signal that never changes teaches people to
stop reading it.

Found by `pnpm audit:schema`, written earlier the same day, which flagged
`is_verified` and `issued_by` as read and never written.

## Decisions

**Checked is a person and a date, not a boolean.** `verified_by` and
`verified_at` replace `is_verified`, and "verified" is computed from
`verifiedAt !== null`. LAW 2: nothing is a fact until somebody confirms it, and
"I have seen the original" is exactly the kind of claim that needs a name
against it. A photocopy in a folder is not a ticket anybody has checked, and
the site that turns a man away does not care which of the two it was.

**The check can be withdrawn.** Both directions are recorded in the audit
trail. A confirmation given in error with no way back is how a wrong fact
becomes permanent — the same failure the ERP has already been bitten by twice
today, in a different shape.

**Who typed it in is shown while the ticket is UNCHECKED.** `recorded_by` and
`created_at`, surfaced on screen 25 as "Saisie par X, le … — personne n'a
encore vu l'original". That is the one moment the fact answers a question
somebody actually has: who do I go and ask for the paper. Once checked, the
line says who checked it instead.

**Blank expiry means "does not expire", and is not a gap.** A CAP is a diploma.
The screen says *n'expire pas* rather than leaving the cell empty, because an
empty cell reads as a date nobody has got round to typing.

**`canWrite`, not a new permission.** The same gate as adding a person, for the
same reason given there: a chef de chantier who has just been handed a welder's
habilitation has to be able to write it down. What a ticket says is not a
privileged fact — the salary is the gated one, and it lives on the person.

**A ticket that expires before it was issued is refused.** It is a typo, and
one the screens would otherwise draw as a man permanently barred from site.

## What was also found

`audit-actions` and the permissions table read the repository with
`git grep -l`, which lists TRACKED files only. Both new actions in this commit
were invisible to the audit until they were staged — which is after the review,
not before. It now passes `--untracked`.

## What was rejected

**A `verify` permission of its own.** Tempting, since checking a ticket is a
control act. But the person who checks the paper is the person the paper is
handed to, and a permission that puts that in the Gérant's hands means the
tickets stay unchecked. The audit trail carries the name; that is the control.

**Keeping `is_verified` and adding the two columns beside it.** Three columns
for one fact, one of which can disagree with the other two.

**A form on screen 51 as well.** One place to type a ticket, on the page whose
subject is the person. Two would drift.
