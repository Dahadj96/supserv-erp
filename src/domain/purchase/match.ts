import Decimal from "decimal.js";

/**
 * Screen 68 — the three-way match.
 *
 * Purchase order, goods received, supplier invoice. Three documents that ought
 * to say the same thing, and the whole value of this screen is the moment they
 * do not: a line invoiced at 3 660 that was quoted at 2 610 and has not
 * arrived. Nobody catches that by reading three PDFs side by side at the end of
 * a month.
 *
 * PURE, and every branch of it is tested. It takes numbers and gives verdicts;
 * it reads nothing and writes nothing. `order.ts` does the database work and
 * calls this, so the arithmetic that decides whether SUPSERV pays a supplier
 * can be checked without a database at all.
 *
 * The verdicts are three, not two, and the third one is the point:
 *
 *   matches        the two sides agree.
 *   explained      they differ, and the difference is already accounted for by
 *                  something else on this screen - invoiced 120 of 140 ordered
 *                  because only 120 arrived. Nothing to chase.
 *   doesNotMatch   they differ and nothing here explains it. This is what
 *                  holds money back.
 *
 * A two-verdict version would paint a partial delivery the same red as a
 * supplier who quietly repriced a line, and a screen that cries wolf on every
 * partial delivery is a screen people click through.
 */

export const VERDICTS = ["matches", "explained", "doesNotMatch"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** One line of the purchase order, with what happened to it on the other two. */
export type MatchLine = {
  /** The order line, so a form can point a receipt or an invoice at it. */
  lineId?: string;
  position: number;
  designation: string | null;
  unit: string | null;
  /** What we ordered. */
  orderedQty: string;
  orderedUnitCost: string;
  /** What arrived, summed across every goods receipt against this order. */
  receivedQty: string;
  /** What the supplier billed. Null when no invoice covers this line yet. */
  invoicedQty: string | null;
  invoicedUnitCost: string | null;
  /**
   * The VAT on this line, as a percentage. The rows above are HT, because
   * that is what the three documents state per unit; the money that leaves
   * the bank is TTC, and `heldIncl` needs to know by how much.
   */
  vatRate?: string | null;
};

export type LineState = "complete" | "partial" | "awaiting" | "over";

export type MatchedLine = MatchLine & {
  remainingQty: string;
  state: LineState;
  /** The price verdict. Null when the supplier has not billed this line. */
  price: Verdict | null;
  /**
   * What the difference on this line is worth, positive when the supplier is
   * asking more than was agreed. Null when there is nothing to compare.
   */
  priceDifference: string | null;
};

function d(value: string | null | undefined): Decimal {
  return new Decimal(value ?? "0");
}

export function lineState(orderedQty: string, receivedQty: string): LineState {
  const ordered = d(orderedQty);
  const received = d(receivedQty);
  if (received.greaterThan(ordered)) return "over";
  if (received.isZero()) return "awaiting";
  if (received.equals(ordered)) return "complete";
  return "partial";
}

export function matchLine(line: MatchLine): MatchedLine {
  const ordered = d(line.orderedQty);
  const received = d(line.receivedQty);

  // Never negative. A supplier who over-delivers has not left us owing them
  // minus twenty units of anything, and "remaining -20" on a screen is the
  // kind of number people stop trusting the whole panel over.
  const remaining = Decimal.max(ordered.minus(received), 0);

  let price: Verdict | null = null;
  let priceDifference: string | null = null;

  if (line.invoicedUnitCost !== null && line.invoicedUnitCost !== undefined) {
    const agreed = d(line.orderedUnitCost);
    const billed = d(line.invoicedUnitCost);
    price = billed.equals(agreed) ? "matches" : "doesNotMatch";
    // Worth what it is worth on the quantity actually BILLED, because that is
    // the money at stake. On the ordered quantity it would overstate a
    // difference the supplier has not yet asked for.
    priceDifference = billed.minus(agreed).times(d(line.invoicedQty)).toFixed(2);
  }

  return {
    ...line,
    // `toString`, not `toFixed(4).replace(...)`. The first version stripped
    // trailing zeros with a regex, which reads "1000" as "1" the day anything
    // hands it a value without a decimal point. Decimal already knows how to
    // print itself without trailing noise.
    remainingQty: remaining.toDecimalPlaces(4).toString(),
    state: lineState(line.orderedQty, line.receivedQty),
    price,
    priceDifference,
  };
}

export type Rollup = {
  ordered: string;
  received: string;
  invoiced: string;
  verdict: Verdict;
};

export type ThreeWayMatch = {
  lines: MatchedLine[];
  /** Quantity across every line. */
  quantity: Rollup;
  /** Value across every line, at each document's own prices. */
  total: Rollup;
  /**
   * What is being asked for above what was agreed, and cannot be explained.
   * This is the figure that stops a payment. HT, like the rows.
   */
  held: string;
  /** The same, with each line's VAT on it — what it is worth at the bank. */
  heldIncl: string;
  /** True when nothing on this order needs a person. */
  clean: boolean;
};

export function threeWayMatch(lines: MatchLine[]): ThreeWayMatch {
  const matched = lines.map(matchLine);

  const sum = (pick: (line: MatchedLine) => Decimal) =>
    matched.reduce((total, line) => total.plus(pick(line)), new Decimal(0));

  const orderedQty = sum((l) => d(l.orderedQty));
  const receivedQty = sum((l) => d(l.receivedQty));
  const invoicedQty = sum((l) => d(l.invoicedQty));

  const orderedValue = sum((l) => d(l.orderedQty).times(d(l.orderedUnitCost)));
  const receivedValue = sum((l) => d(l.receivedQty).times(d(l.orderedUnitCost)));
  const invoicedValue = sum((l) => d(l.invoicedQty).times(d(l.invoicedUnitCost)));

  /**
   * Billing MORE than arrived is the only quantity difference worth stopping a
   * payment for. Billing less is the supplier's loss and our cash flow's gain;
   * billing exactly what arrived while the order is short is a partial
   * delivery, which the Remaining column already says.
   */
  const quantityVerdict: Verdict = invoicedQty.greaterThan(receivedQty)
    ? "doesNotMatch"
    : invoicedQty.equals(orderedQty) && receivedQty.equals(orderedQty)
      ? "matches"
      : "explained";

  const disputed = matched.filter((line) => line.price === "doesNotMatch");
  const held = disputed.reduce(
    (total, line) => total.plus(Decimal.max(d(line.priceDifference), 0)),
    new Decimal(0),
  );
  const heldIncl = disputed.reduce(
    (total, line) =>
      total.plus(Decimal.max(d(line.priceDifference), 0).times(d(line.vatRate).div(100).plus(1))),
    new Decimal(0),
  );

  /**
   * The total is judged against what the order committed to, not against what
   * arrived. A supplier who invoices the full order before delivering half of
   * it has not made an arithmetic mistake - and "matches" on that row, because
   * the invoice happens to equal the purchase order, would be the screen
   * agreeing with them.
   */
  const overBilled = invoicedValue.greaterThan(orderedValue);
  const underBilled = invoicedValue.lessThan(orderedValue);
  const totalVerdict: Verdict = overBilled
    ? "doesNotMatch"
    : underBilled || !receivedValue.equals(orderedValue)
      ? "explained"
      : "matches";

  return {
    lines: matched,
    quantity: {
      ordered: orderedQty.toDecimalPlaces(4).toString(),
      received: receivedQty.toDecimalPlaces(4).toString(),
      invoiced: invoicedQty.toDecimalPlaces(4).toString(),
      verdict: quantityVerdict,
    },
    total: {
      ordered: orderedValue.toFixed(2),
      received: receivedValue.toFixed(2),
      invoiced: invoicedValue.toFixed(2),
      verdict: totalVerdict,
    },
    held: held.toFixed(2),
    heldIncl: heldIncl.toFixed(2),
    clean: quantityVerdict !== "doesNotMatch" && totalVerdict !== "doesNotMatch" && held.isZero(),
  };
}

/**
 * What may be paid today.
 *
 * Deliberately not "invoiced minus paid". A supplier invoice with a line
 * nobody can explain is not a bill that is 96 % payable and 4 % disputed - it
 * is a bill with a question on it, and the answer the screen has to give a
 * person about to press pay is a number they can defend afterwards.
 *
 * So the held amount comes off, and it comes off before the payments already
 * made, because money already gone cannot be un-held.
 */
export function safeToPayNow(opts: { invoiced: string; paid: string; held: string }): string {
  const outstanding = d(opts.invoiced).minus(d(opts.paid)).minus(d(opts.held));
  return Decimal.max(outstanding, 0).toFixed(2);
}
