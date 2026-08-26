import Decimal from "decimal.js";

/**
 * Screens 49 and 14 — what has been delivered, and what that unlocks.
 *
 * Every figure on both screens comes from this file, and not one of them is
 * stored. "Already delivered 12" is the sum of the quantities on the bons de
 * livraison that have actually been ISSUED; "remaining" is subtraction. A
 * `delivered_qty` column on the order line would need somebody to remember to
 * update it on every BL, on every cancelled BL and on every correction — and
 * the first time somebody forgot, the screen would say a client had been sent
 * goods they were still waiting for.
 *
 * ISSUED, not drafted. A BL sitting in a draft has delivered nothing; the lorry
 * has not left. Counting drafts would let somebody invoice for goods still in
 * the warehouse, which is the one mistake this screen exists to prevent.
 */

const d = (value: string | number | null | undefined) => {
  const parsed = new Decimal(String(value ?? "0") || "0");
  return parsed.isFinite() ? parsed : new Decimal(0);
};

export type SourceLine = {
  lineId: string;
  position: number;
  designation: string | null;
  unit: string | null;
  /** What the client ordered. */
  qty: string;
};

/** One line on one bon de livraison, pointing back at what it delivers. */
export type DeliveredLine = {
  sourceLineId: string | null;
  qty: string;
  /** Only an issued BL has delivered anything. */
  issued: boolean;
};

/**
 * `complete`   — everything ordered has gone and nothing is left.
 * `completes`  — the delivery being built right now finishes it.
 * `partial`    — some has gone, some has not, and none of it is on this BL.
 * `planned`    — nothing has gone yet, and this BL carries some of it.
 * `open`       — nothing has gone and nothing is on this BL.
 * `over`       — more has been delivered than was ordered. Not an error to
 *                refuse: it happens, somebody loaded an extra drum, and the
 *                screen has to be able to say so rather than clamping to zero
 *                and leaving two people arguing about a lorry.
 */
export const LINE_STATES = ["complete", "completes", "partial", "planned", "open", "over"] as const;
export type LineState = (typeof LINE_STATES)[number];

export type LineProgress = {
  lineId: string;
  position: number;
  designation: string | null;
  unit: string | null;
  ordered: string;
  /** Issued on every other bon de livraison. */
  alreadyDelivered: string;
  /** On the one being built or read. Zero when there is no BL in hand. */
  thisDelivery: string;
  /** Ordered less already less this. Never negative — see `over`. */
  remaining: string;
  state: LineState;
};

export function progressOf(opts: {
  source: SourceLine;
  /** Every BL line anywhere that points at this source line. */
  delivered: DeliveredLine[];
  /** Lines of the BL currently in hand, if any. */
  current?: DeliveredLine[];
}): LineProgress {
  const ordered = d(opts.source.qty);

  const already = opts.delivered
    .filter((line) => line.issued && line.sourceLineId === opts.source.lineId)
    .reduce((sum, line) => sum.plus(d(line.qty)), new Decimal(0));

  const thisTime = (opts.current ?? [])
    .filter((line) => line.sourceLineId === opts.source.lineId)
    .reduce((sum, line) => sum.plus(d(line.qty)), new Decimal(0));

  const covered = already.plus(thisTime);
  const left = ordered.minus(covered);

  const state: LineState = covered.greaterThan(ordered)
    ? "over"
    : left.isZero() && thisTime.greaterThan(0)
      ? "completes"
      : left.isZero()
        ? "complete"
        : thisTime.greaterThan(0)
          ? "planned"
          : already.greaterThan(0)
            ? "partial"
            : "open";

  return {
    lineId: opts.source.lineId,
    position: opts.source.position,
    designation: opts.source.designation,
    unit: opts.source.unit,
    ordered: ordered.toDecimalPlaces(4).toFixed(),
    alreadyDelivered: already.toDecimalPlaces(4).toFixed(),
    thisDelivery: thisTime.toDecimalPlaces(4).toFixed(),
    remaining: (left.isNegative() ? new Decimal(0) : left).toDecimalPlaces(4).toFixed(),
    state,
  };
}

export type Progress = {
  lines: LineProgress[];
  /** Lines with nothing left to deliver. Screen 14's "4 of 9 lines delivered". */
  linesComplete: number;
  linesTotal: number;
  /** Whole percent, by quantity. */
  pct: string;
  /** Lines that still owe the client something. */
  open: number;
};

/**
 * Screen 14's "4 of 9 lines delivered · 44%".
 *
 * The count and the bar answer different questions and the frame prints both:
 * 4 of 9 is how many lines are finished, and the bar is how much of the
 * quantity has actually gone. A bar driven by the line count reads 44% when the
 * four finished lines are the small ones, which flatters. Both are here, and
 * neither is derived from the other.
 */
export function progress(opts: {
  sources: SourceLine[];
  delivered: DeliveredLine[];
  current?: DeliveredLine[];
}): Progress {
  const lines = opts.sources.map((source) =>
    progressOf({ source, delivered: opts.delivered, current: opts.current }),
  );

  const ordered = lines.reduce((sum, line) => sum.plus(d(line.ordered)), new Decimal(0));
  // Capped per line, so one over-delivery cannot push the whole bar past 100%
  // and hide three lines that never went out.
  const gone = lines.reduce(
    (sum, line) => sum.plus(Decimal.min(d(line.alreadyDelivered), d(line.ordered))),
    new Decimal(0),
  );

  return {
    lines,
    linesComplete: lines.filter((line) => line.state === "complete" || line.state === "over")
      .length,
    linesTotal: lines.length,
    pct: ordered.isZero() ? "0" : gone.dividedBy(ordered).times(100).toDecimalPlaces(0).toFixed(0),
    open: lines.filter((line) => d(line.remaining).greaterThan(0)).length,
  };
}

/**
 * Screen 49's "What this unlocks", and screen 14's.
 *
 *   Invoice the delivered lines   Allowed
 *   Invoice everything            Blocked — 1 line open
 *   Signed proof required         Yes, before chasing
 *
 * The third is not a state of this delivery, it is a policy, and it is stated
 * because it is the reason the other two matter: "Without a signed delivery
 * note, a delivery dispute has no answer. This is the document that protects
 * the invoice."
 */
export type Unlocks = {
  /** At least one line has actually gone. */
  invoiceDelivered: boolean;
  /** Nothing is outstanding. */
  invoiceEverything: boolean;
  /** How many lines are still open, for the blocked message. */
  linesOpen: number;
  /**
   * Goods have gone out and no signed copy has come back. Screen 14's amber
   * banner, and the reason screen 20 should hesitate before chasing an invoice
   * that rests on it.
   */
  proofMissing: boolean;
};

export function unlocks(opts: {
  progress: Progress;
  /** Null while no signed copy has been filed. */
  signedCopyOnFile: Date | null;
  anythingDelivered: boolean;
}): Unlocks {
  return {
    invoiceDelivered: opts.anythingDelivered,
    invoiceEverything: opts.progress.open === 0 && opts.progress.linesTotal > 0,
    linesOpen: opts.progress.open,
    proofMissing: opts.anythingDelivered && opts.signedCopyOnFile === null,
  };
}
