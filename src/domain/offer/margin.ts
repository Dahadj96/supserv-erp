import Decimal from "decimal.js";

/**
 * Screen 12 — the Cost and Margin columns.
 *
 * MARGIN IS NEVER STORED. There is no `margin_pct` column on `document_line`
 * and there will not be one. It is `(price − cost) / cost`, computed wherever
 * it is shown. LAW 1, and the reason is not tidiness: cost, price and margin
 * are three numbers where two are enough, and on the day the third disagrees —
 * because somebody edited the price and a job updated the margin, or did not —
 * nobody can say which two are right.
 *
 * Everything here is `Decimal`. A margin of 17.2% on 1 001 700 dinars computed
 * in binary floating point is off by centimes, and centimes on a tender
 * document are what an inspector asks about.
 */

const d = (value: string | number | null | undefined): Decimal => {
  const text = String(value ?? "0")
    .replace(/[\s ]/g, "")
    .replace(",", ".");
  const parsed = new Decimal(text || "0");
  return parsed.isFinite() ? parsed : new Decimal(0);
};

/**
 * The margin a price carries over a cost, as a percentage of the COST.
 *
 * Margin on cost, not margin on price — the same choice `costing.ts` makes, for
 * the same reason: this office quotes "cost plus twenty per cent". Returns null
 * when there is no cost to measure against, because a price with no cost behind
 * it has no margin; it has a missing cost, and "∞%" on a screen is how that
 * gets mistaken for good news.
 */
export function marginPct(unitCost: string | null, unitPrice: string | null): string | null {
  if (unitCost === null || unitPrice === null) return null;
  const cost = d(unitCost);
  if (cost.isZero()) return null;
  return d(unitPrice).minus(cost).dividedBy(cost).times(100).toDecimalPlaces(2).toFixed(2);
}

/** The price that yields a given margin over a cost. The inverse of the above. */
export function priceFromMargin(unitCost: string, pct: string): string {
  const cost = d(unitCost);
  return cost
    .plus(cost.times(d(pct)).dividedBy(100))
    .toDecimalPlaces(4)
    .toFixed(4);
}

/** The cash a line makes: (price − cost) × qty. Negative is a real answer. */
export function lineMargin(line: {
  unitCost: string | null;
  unitPrice: string | null;
  qty: string | null;
}): string | null {
  if (line.unitCost === null || line.unitPrice === null) return null;
  return d(line.unitPrice).minus(d(line.unitCost)).times(d(line.qty)).toDecimalPlaces(2).toFixed(2);
}

export type MarginLine = {
  unitCost: string | null;
  unitPrice: string | null;
  qty: string | null;
  isOption?: boolean;
  lineKind?: string;
};

export type MarginSummary = {
  totalCost: string;
  totalExcl: string;
  margin: string;
  /** Overall margin as a percentage of total cost. Null when nothing has one. */
  marginPct: string | null;
  /** Lines with a price and no cost. They flatter the margin by being absent. */
  linesWithoutCost: number;
  /** Lines sold at or below cost. Sometimes deliberate; always worth seeing. */
  linesAtOrBelowCost: number;
};

/**
 * The Totals card, cost side.
 *
 * `linesWithoutCost` is the number that keeps the headline honest. An offer
 * where four lines of six have costs shows a margin computed over those four,
 * and that percentage looks like the margin on the offer. It is not — the other
 * two could be sold at a loss and the figure would not move. So the count is
 * returned beside it and the screen prints it.
 *
 * Options are excluded, matching `computeTotals`: an option is shown to the
 * client and not sold, so counting its margin inflates a number somebody is
 * about to make a decision on.
 */
export function summariseMargin(lines: MarginLine[]): MarginSummary {
  let totalCost = new Decimal(0);
  let totalExcl = new Decimal(0);
  let linesWithoutCost = 0;
  let linesAtOrBelowCost = 0;

  for (const line of lines) {
    if (line.lineKind && line.lineKind !== "item") continue;
    if (line.isOption) continue;
    if (line.unitPrice === null) continue;

    const qty = d(line.qty);
    totalExcl = totalExcl.plus(d(line.unitPrice).times(qty));

    if (line.unitCost === null) {
      linesWithoutCost += 1;
      continue;
    }
    totalCost = totalCost.plus(d(line.unitCost).times(qty));
    if (d(line.unitPrice).lessThanOrEqualTo(d(line.unitCost))) linesAtOrBelowCost += 1;
  }

  const margin = totalExcl.minus(totalCost);

  return {
    totalCost: totalCost.toDecimalPlaces(2).toFixed(2),
    totalExcl: totalExcl.toDecimalPlaces(2).toFixed(2),
    margin: margin.toDecimalPlaces(2).toFixed(2),
    marginPct: totalCost.isZero()
      ? null
      : margin.dividedBy(totalCost).times(100).toDecimalPlaces(1).toFixed(1),
    linesWithoutCost,
    linesAtOrBelowCost,
  };
}

/**
 * Screen 12's "Apply margin to all lines".
 *
 * Only touches lines that HAVE a cost. Applying a margin to a line with no cost
 * would have to invent one, and the invented number would then be printed in
 * the Cost column as though somebody had found it.
 */
export function applyMarginToAll<T extends MarginLine>(lines: T[], pct: string): T[] {
  return lines.map((line) =>
    line.unitCost === null || line.lineKind === "section" || line.lineKind === "text"
      ? line
      : { ...line, unitPrice: priceFromMargin(line.unitCost, pct) },
  );
}
