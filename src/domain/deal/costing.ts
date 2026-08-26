import Decimal from "decimal.js";
import { readQty } from "./paste";

/**
 * Screen 74 — "When there is no supplier: services priced by us".
 *
 * The frame's own justification, and it is the reason this is not just a number
 * somebody types: "A service line has no supplier and never will. It still
 * needs a cost, so the margin on the offer is real rather than assumed."
 *
 * Installation, commissioning, a crew on site for three days — nobody will ever
 * send a proforma for these. Without a costing they get priced by feel, and a
 * margin computed against a price that was itself a guess is a margin that
 * means nothing. Six numbers turn it into arithmetic.
 *
 * Decimal throughout, for the same reason as `money.ts`: 39 000 + 8 000 + 14
 * 000 + 5 000 must be 66 000 exactly, on every machine, forever.
 */

export type Costing = {
  /** People × days. Both kept, because "2 × 3" and "6" cost the same and mean
   *  different things when somebody revisits the estimate in November. */
  people: number;
  days: number;
  dailyRate: string;
  materials: string;
  transport: string;
  /** What is set aside for the thing nobody thought of. */
  contingency: string;
  /** The margin taken on the whole cost, as a percentage. */
  marginPct: string;
};

export type CostingResult = {
  labourCost: string;
  cost: string;
  margin: string;
  price: string;
};

/**
 * A number as somebody in this office types it: `6 500`, `1 000,50`, `8000`.
 *
 * `readQty` from the paste reader does exactly this job and has already been
 * argued with about whether `1,500` is fifteen hundred or one and a half. One
 * idea of "read a number a person typed", in one place — a second one here
 * would disagree with it on the day it mattered.
 *
 * Anything unreadable is zero rather than NaN. A blank contingency field means
 * no contingency, and an empty box should not turn the whole estimate into
 * `NaN DZD` — which is a thing that has happened in this codebase before.
 */
const money = (value: string | number) => {
  const read = readQty(String(value ?? ""));
  return read === null ? new Decimal(0) : new Decimal(read);
};

/**
 * Cost, margin and price.
 *
 * The margin is taken ON TOP of the cost — `price = cost × (1 + margin)` — not
 * carved out of the price. The frame's numbers say which one it is: 66 000 cost
 * at 30% shows a price of 86 000, and 66 000 × 1.3 is 85 800, rounded to the
 * nearest hundred dinars the way a person writing an offer rounds it. Margin on
 * cost, not margin on price.
 *
 * That distinction is worth being certain about: on 30%, treating it as margin
 * on price would give 94 286, and the difference is eight thousand dinars.
 */
export function computeCosting(input: Costing): CostingResult {
  const labourCost = money(input.dailyRate)
    .times(Math.max(0, input.people || 0))
    .times(Math.max(0, input.days || 0));

  const cost = labourCost
    .plus(money(input.materials))
    .plus(money(input.transport))
    .plus(money(input.contingency));

  const margin = cost.times(money(input.marginPct)).dividedBy(100);

  return {
    labourCost: labourCost.toDecimalPlaces(2).toFixed(2),
    cost: cost.toDecimalPlaces(2).toFixed(2),
    margin: margin.toDecimalPlaces(2).toFixed(2),
    price: cost.plus(margin).toDecimalPlaces(2).toFixed(2),
  };
}

/**
 * The margin a price implies, given a cost. The inverse, for the case where
 * somebody has already decided the number and wants to know what it leaves.
 *
 * Returns null for a cost of zero rather than infinity: a price with no cost
 * behind it has no margin, it has a missing costing, and "∞%" on a screen is
 * how that gets mistaken for good news.
 */
export function impliedMarginPct(cost: string, price: string): string | null {
  const c = money(cost);
  if (c.isZero()) return null;
  return money(price).minus(c).dividedBy(c).times(100).toDecimalPlaces(2).toFixed(2);
}
