import Decimal from "decimal.js";
import type { Instrument } from "./instruments";

/**
 * The droit de timbre on a sum settled in cash.
 *
 * PURE, and it makes no legal claim of its own. What it computes is the barème
 * as `AUTHORITY` below states it, and whether that barème APPLIES to a given
 * document is decided elsewhere — by `invoice.stampDutyThreshold` in the
 * compliance profile, which a person confirms with a name and a date. Until
 * they do, `saveDraft` does not call this, and the invoice warns instead.
 * That is screen 69's rule: the software enforces, it does not assert.
 *
 * THE BARÈME, as written down here on 1 September 2026 from the loi de
 * finances 2025 (art. 47, amending art. 100 of the Code du timbre) and the
 * DGI circular n° 14/MF/DGI/LF.2025 of 5 March 2025:
 *
 *   - nothing on a sum of 300 DA or less;
 *   - above that, the sum is cut into tranches of 100 DA, any started tranche
 *     counting as a whole one, and EVERY tranche pays the rate of the bracket
 *     the WHOLE sum falls in — not a marginal scale:
 *         up to 30 000 DA  →  1 DA per tranche
 *         up to 100 000 DA →  1.50 DA per tranche
 *         above            →  2 DA per tranche
 *   - never less than 5 DA;
 *   - no ceiling. The 2 500 DA cap that older invoices show was removed by
 *     the same article.
 *
 * On the sum actually received in cash — the total including VAT. A transfer,
 * a cheque, a traite or a compensation pay nothing under this article.
 *
 * If a finance act changes a figure, this file changes and the authority line
 * with it. A person confirming the rule on screen 69 is confirming THIS text.
 */
export const STAMP_DUTY_AUTHORITY =
  "LF 2025 art. 47 — Code du timbre art. 100 ; circulaire DGI n° 14/MF/DGI/LF.2025 du 05/03/2025";

export const EXEMPT_UP_TO = new Decimal(300);
export const TRANCHE = new Decimal(100);
export const MINIMUM = new Decimal(5);

const BRACKETS: { upTo: Decimal | null; perTranche: Decimal }[] = [
  { upTo: new Decimal(30_000), perTranche: new Decimal(1) },
  { upTo: new Decimal(100_000), perTranche: new Decimal(1.5) },
  { upTo: null, perTranche: new Decimal(2) },
];

/** Which instruments attract the duty. Only one does. */
export function attractsStampDuty(settlement: Instrument | string | null | undefined): boolean {
  return settlement === "especes";
}

/**
 * The duty on a sum, in DZD, to the centime. Nought when nothing is due.
 *
 * Takes the total INCLUDING VAT, because that is the sum that changes hands.
 */
export function stampDutyOn(totalIncl: Decimal.Value): string {
  const sum = new Decimal(totalIncl);
  if (sum.lessThanOrEqualTo(EXEMPT_UP_TO)) return "0.00";

  const tranches = sum.dividedBy(TRANCHE).ceil();
  const bracket = BRACKETS.find((b) => b.upTo === null || sum.lessThanOrEqualTo(b.upTo));
  const duty = tranches.times(bracket?.perTranche ?? new Decimal(2));

  return Decimal.max(duty, MINIMUM).toFixed(2);
}

/**
 * What a draft should carry, given how it will be settled and whether the
 * rule has been confirmed. The one function `saveDraft` calls.
 */
export function stampDutyFor(opts: {
  totalIncl: Decimal.Value;
  settlement: Instrument | string | null | undefined;
  ruleConfirmed: boolean;
}): string {
  if (!opts.ruleConfirmed) return "0.00";
  if (!attractsStampDuty(opts.settlement)) return "0.00";
  return stampDutyOn(opts.totalIncl);
}
