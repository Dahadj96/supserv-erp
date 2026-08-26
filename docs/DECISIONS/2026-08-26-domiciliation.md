# Screen 19 asserts three rules of law. We hold two and refuse the third.

**Raised** 26 August 2026, building screen 19 (Payments).
**Open. For the Gérant and the accountant.**

## What the mockup says

The "Rules that apply" card on screen 19 prints four rows as settled fact:

| Row | What the frame says |
|---|---|
| Cash payment | Droit de timbre applies |
| Bank transfer | No timbre |
| Foreign currency | Domiciliation required |
| Partial payment | Allowed — balance tracked |

Three of those are claims about Algerian law. The fourth is a claim about this
software.

## What screen 69 says

> The software enforces these rules. It does not assert that they are the law.
> Each one names its source and the person who confirmed it — and until someone
> does, it is marked unconfirmed and enforced as a warning only.

So the card cannot print row 1 as a fact. `invoice.stampDutyThreshold` is one
of the four rules screen 85 hands to the accountant, and it is unconfirmed —
nobody has told this system the threshold, the rate, or what happens on a
settlement that is part cash and part transfer. Until they do, rows 1 and 2 read
**"threshold not confirmed"** and the payment is recorded anyway. Confirm the
rule at `/settings/compliance` and both rows start stating the consequence.

Row 4 is not a rule at all. Partial payments are tracked because a payment is
its own row and its allocation is separate — there is no `paid_amount` column to
round off. It is structural, it says so, and it cannot be switched off.

## The one that is open — domiciliation

Row 3 has no rule behind it anywhere in this system. It was not omitted; it was
**not written down**, and writing it down is the decision being asked for here.

What the software does today: when a payment arrives in a currency other than
DZD, the card says the bank formalities that follow — domiciliation,
rapatriement — are not rules it has been given, and that nothing here checks
them. It records the payment.

What it does **not** do, deliberately:

- it does not add a fifth rule to the compliance profile on its own authority.
  Screen 69 exists to stop the software inventing confirmable rules, and
  inventing one out of a mockup is exactly that;
- it does not convert foreign currency into dinars anywhere. No exchange rate
  has ever been recorded in this system, so the quarter-to-date card names the
  other currencies beside the total instead of folding them into it.

## What we need told

1. Is there a bank formality on a **receipt** in foreign currency from a client,
   and is it the same one as on an import? (Domiciliation is normally a rule
   about money going out. The frame may be carrying an import rule onto a
   receipts screen.)
2. If there is, what triggers it — the currency, the client being abroad, the
   amount, or the contract?
3. Who is the authority for it, so the rule can name its source the way the
   décret 05-468 rules do?

Answer those three and it becomes a real rule with a code, an authority, a
confirmation and a date, and the row starts saying something. Until then the
screen asks rather than asserts, which is the only honest thing it can do.

## Related

- `src/domain/money/instruments.ts` — the four rows and the basis of each.
- `tests/unit/payment-rules.test.ts` — asserts the opposite of the mockup, on
  purpose, so nobody "fixes" it later.
- `docs/DECISIONS/2026-08-26-who-sees-margin.md` — the other open question.
