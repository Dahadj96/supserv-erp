import Decimal from "decimal.js";

/**
 * Screen 42 — the bordereau des prix unitaires, and the erratum.
 *
 * A BPU is the client's own priced schedule: forty-two lines with their
 * numbers, their designations, their quantities and an empty price column. It
 * arrives as a spreadsheet, it is imported rather than retyped, and then — a
 * fortnight before the deadline, when thirty-one lines have been priced — the
 * buyer issues an ERRATUM.
 *
 * That is what this file is for. An erratum changes a quantity here, a
 * designation there, removes a line, adds one. Re-importing the file would be
 * correct and would throw away every price already gathered; ignoring it means
 * submitting against the wrong quantities. Neither is acceptable, so the
 * incoming file is DIFFED against what is held, and the diff is what a person
 * reviews.
 *
 * PURE. Lines in, changes out. `store.ts` reads and writes.
 *
 * THE LINE NUMBER IS THE IDENTITY. Not the designation — an erratum that
 * rewords line 18 is still line 18, and matching on words would report a
 * deletion and an addition and lose the price attached to it. The client
 * numbers their own schedule and every conversation about it uses that number.
 */

export const CHANGES = [
  "added",
  "removed",
  "quantityChanged",
  "designationChanged",
  "unitChanged",
  "unchanged",
] as const;
export type ChangeKind = (typeof CHANGES)[number];

export type BpuLine = {
  /** The client's own line number. Their #4 stays our #4. */
  position: number;
  reference: string | null;
  designation: string;
  unit: string | null;
  qty: string;
};

export type LineChange = {
  position: number;
  kind: ChangeKind;
  before: BpuLine | null;
  after: BpuLine | null;
  /** Filled for a quantity change, so the screen can print "1 000 → 1 400". */
  from?: string;
  to?: string;
};

function same(a: string | null, b: string | null): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/**
 * What this erratum actually changes.
 *
 * A line can change in more than one way at once. The kind reported is the
 * FIRST that applies in this order — quantity, designation, unit — because
 * quantity is the one that changes the money and a screen that reported a
 * reworded line while its quantity had gone from 1 000 to 1 400 would be
 * telling somebody the wrong thing.
 */
export function diffBpu(current: BpuLine[], incoming: BpuLine[]): LineChange[] {
  const held = new Map(current.map((line) => [line.position, line]));
  const arrived = new Map(incoming.map((line) => [line.position, line]));

  const positions = [...new Set([...held.keys(), ...arrived.keys()])].sort((a, b) => a - b);
  const changes: LineChange[] = [];

  for (const position of positions) {
    const before = held.get(position) ?? null;
    const after = arrived.get(position) ?? null;

    if (!before && after) {
      changes.push({ position, kind: "added", before: null, after });
      continue;
    }
    if (before && !after) {
      changes.push({ position, kind: "removed", before, after: null });
      continue;
    }
    if (!before || !after) continue;

    if (!new Decimal(before.qty).equals(new Decimal(after.qty))) {
      changes.push({
        position,
        kind: "quantityChanged",
        before,
        after,
        from: before.qty,
        to: after.qty,
      });
      continue;
    }
    if (!same(before.designation, after.designation)) {
      changes.push({ position, kind: "designationChanged", before, after });
      continue;
    }
    if (!same(before.unit, after.unit)) {
      changes.push({
        position,
        kind: "unitChanged",
        before,
        after,
        from: before.unit ?? "",
        to: after.unit ?? "",
      });
      continue;
    }

    changes.push({ position, kind: "unchanged", before, after });
  }

  return changes;
}

/** Only the ones a person has to look at. */
export function material(changes: LineChange[]): LineChange[] {
  return changes.filter((change) => change.kind !== "unchanged");
}

/**
 * WHICH PRICES SURVIVE THE ERRATUM.
 *
 * A quantity change keeps the price — the unit price of a valve does not depend
 * on how many the client wants, and making somebody re-quote forty lines
 * because the buyer moved a number is how a deadline gets missed.
 *
 * A DESIGNATION change does not. "Vanne papillon DN80" becoming "Vanne
 * papillon DN100" is a different article at a different price, and the words
 * are the only thing that says so. The system cannot tell a clarification from
 * a substitution, and guessing in the direction that keeps the old price is the
 * guess that puts a wrong number on a submitted bid.
 *
 * A unit change does not either, and for the same reason: a price per metre is
 * not a price per unit.
 */
export function keepsItsPrice(kind: ChangeKind): boolean {
  return kind === "unchanged" || kind === "quantityChanged";
}

export type ErratumSummary = {
  added: number;
  removed: number;
  repriced: number;
  /** Lines that change and lose the price already gathered for them. */
  losesPrice: number;
  unchanged: number;
};

export function summarise(changes: LineChange[]): ErratumSummary {
  const count = (kind: ChangeKind) => changes.filter((c) => c.kind === kind).length;
  return {
    added: count("added"),
    removed: count("removed"),
    repriced: count("quantityChanged"),
    losesPrice: changes.filter(
      (c) =>
        c.kind !== "unchanged" &&
        c.kind !== "added" &&
        c.kind !== "removed" &&
        !keepsItsPrice(c.kind),
    ).length,
    unchanged: count("unchanged"),
  };
}

/* ------------------------------------------------------- pricing the BPU */

export const LINE_STATES = ["priced", "awaitingQuote", "noPrice"] as const;
export type LineState = (typeof LINE_STATES)[number];

export type PricedLine = {
  position: number;
  reference: string | null;
  designation: string;
  unit: string | null;
  qty: string;
  /** What we last actually paid for this article. Null when never bought. */
  lastPaid: string | null;
  /** The best cost we hold today. */
  cost: string | null;
  /** What we intend to charge. Null until somebody prices it. */
  ourPrice: string | null;
  /** True when a supplier has been asked and has not answered yet. */
  awaitingQuote: boolean;
};

export type PricedRow = PricedLine & {
  state: LineState;
  /** (price − cost) / cost, one decimal. Null without both. */
  marginPct: number | null;
  /** qty × price. Null until priced. */
  lineTotal: string | null;
};

export function readLine(line: PricedLine): PricedRow {
  const state: LineState = line.ourPrice
    ? "priced"
    : line.awaitingQuote
      ? "awaitingQuote"
      : "noPrice";

  const marginPct =
    line.ourPrice && line.cost && Number(line.cost) > 0
      ? Math.round(((Number(line.ourPrice) - Number(line.cost)) / Number(line.cost)) * 1000) / 10
      : null;

  return {
    ...line,
    state,
    marginPct,
    lineTotal: line.ourPrice
      ? new Decimal(line.qty).times(new Decimal(line.ourPrice)).toFixed(2)
      : null,
  };
}

export type BpuTotals = {
  lines: number;
  priced: number;
  awaitingQuote: number;
  noPrice: number;
  /** Cost of the priced lines only. */
  totalCost: string;
  /** Value of the priced lines only. */
  totalExcl: string;
  marginAmount: string;
  marginPct: number | null;
  /** The bid bond, at the percentage the cahier des charges states. */
  caution: string | null;
};

export function bpuTotals(rows: PricedRow[], cautionPct: string | null): BpuTotals {
  const priced = rows.filter((row) => row.state === "priced");

  /**
   * The totals cover the PRICED lines and say how many are not.
   *
   * A total over forty-two lines of which eleven have no price is a number
   * eleven lines short, and printing it as "Total HT" invites somebody to
   * submit it. The count beside it is what makes the figure honest.
   */
  const totalExcl = priced.reduce(
    (sum, row) => sum.plus(new Decimal(row.lineTotal ?? "0")),
    new Decimal(0),
  );
  const totalCost = priced.reduce(
    (sum, row) => sum.plus(new Decimal(row.qty).times(new Decimal(row.cost ?? "0"))),
    new Decimal(0),
  );

  const margin = totalExcl.minus(totalCost);

  return {
    lines: rows.length,
    priced: priced.length,
    awaitingQuote: rows.filter((row) => row.state === "awaitingQuote").length,
    noPrice: rows.filter((row) => row.state === "noPrice").length,
    totalCost: totalCost.toFixed(2),
    totalExcl: totalExcl.toFixed(2),
    marginAmount: margin.toFixed(2),
    marginPct: totalCost.greaterThan(0)
      ? Math.round(margin.dividedBy(totalCost).times(1000).toNumber()) / 10
      : null,
    caution:
      cautionPct && totalExcl.greaterThan(0)
        ? totalExcl.times(new Decimal(cautionPct)).dividedBy(100).toFixed(2)
        : null,
  };
}

/**
 * How much prices have moved since we last bought these articles.
 *
 * The frame calls it "average price drift" and puts a sentence under it: line 1
 * was sold at 2 140 in November, costs are up 3.8 % since, pricing at 2 254
 * keeps the same margin. That sentence is only worth printing when there is
 * something to compare, so this returns null rather than nought when nothing
 * has been bought before.
 */
export function priceDrift(rows: PricedRow[]): { pct: number; lines: number } | null {
  const comparable = rows.filter(
    (row) => row.lastPaid !== null && row.cost !== null && Number(row.lastPaid) > 0,
  );
  if (comparable.length === 0) return null;

  const total = comparable.reduce(
    (sum, row) => sum + (Number(row.cost) - Number(row.lastPaid)) / Number(row.lastPaid),
    0,
  );

  return {
    pct: Math.round((total / comparable.length) * 1000) / 10,
    lines: comparable.length,
  };
}
