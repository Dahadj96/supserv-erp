import Decimal from "decimal.js";

/**
 * Screen 67 — "Conflicts the system found · checked against what the client
 * asked for".
 *
 * This is the most valuable thing sourcing does, and it is entirely arithmetic.
 * Nobody reads a supplier's reply next to a forty-page cahier des charges and
 * notices that the offer validity is sixty days short. The system has both
 * numbers and can subtract them.
 *
 * Two rules run through the whole file:
 *
 *   1. NOTHING IS BLOCKED. Every conflict offers "ask the supplier" or "accept
 *      the risk" and the bid goes out either way. LAW 6 — the assistant
 *      proposes; the Gérant decides whether a 34-day lead time is worth the
 *      penalty clause.
 *   2. NO REQUIREMENT, NO CONFLICT. A check against a requirement nobody
 *      confirmed is a false alarm, and false alarms are how people learn to
 *      click past red boxes. Every check returns nothing when the client's side
 *      of it is unknown.
 */

export const RESPONSE_STATUSES = ["asked", "quoted", "declined", "no_reply", "bounced"] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];

export type SupplierAnswer = {
  responseId: string;
  partyId: string;
  supplierName: string;
  status: ResponseStatus;
  validityDays: number | null;
  leadTimeDays: number | null;
  currency: string;
  /** dealLineId → unit price. A line the supplier did not price is absent. */
  prices: Map<string, string>;
};

/** What the client demanded, once a person has confirmed it. */
export type ClientRequires = {
  validityDays: number | null;
  deliveryDays: number | null;
  latePenalty: string | null;
  currency: string;
  /** The client's own deadline, for the buffer calculation. */
  deadlineAt: Date | null;
};

export const CONFLICT_KINDS = [
  "validityShorterThanRequired",
  "leadTimeLongerThanRequired",
  "currencyDiffers",
  "pricedNothing",
] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];

export type Conflict = {
  kind: ConflictKind;
  severity: "critical" | "warning";
  supplierName: string;
  responseId: string;
  /** Both sides of the comparison, as numbers the screen prints. */
  clientSide: string;
  supplierSide: string;
  /** Values for the consequence sentence. The sentence itself is an i18n key. */
  detail: Record<string, string | number>;
};

/** The date a supplier's price stops binding them, given when they quoted. */
export function heldUntil(answer: SupplierAnswer, quotedOn: Date | null): Date | null {
  if (!quotedOn || answer.validityDays === null) return null;
  return new Date(quotedOn.getTime() + answer.validityDays * 86_400_000);
}

/**
 * Find every conflict between what the client asked for and what the suppliers
 * offered.
 *
 * Only `quoted` suppliers are checked. A supplier who declined has no offer to
 * conflict with, and raising "no prices given" against somebody who politely
 * said no is noise — which is exactly what `pricedNothing` is for: a supplier
 * who said "quoted" and then priced nothing at all.
 */
export function conflictsOf(opts: {
  requires: ClientRequires;
  answers: SupplierAnswer[];
  lineIds: string[];
  /** When each supplier's quote arrived, for the validity arithmetic. */
  quotedOn: Map<string, Date | null>;
  total: (answer: SupplierAnswer, lineIds: string[]) => string;
}): Conflict[] {
  const out: Conflict[] = [];

  for (const answer of opts.answers) {
    if (answer.status !== "quoted") continue;

    // 1 — Offer validity shorter than the client requires.
    //
    // The consequence, in the frame's own words: "If TouatGaz decides after 16
    // September, Hydro-Equip is no longer held to 1 001 700. You would be
    // committed at a price your supplier is not."
    if (
      opts.requires.validityDays !== null &&
      answer.validityDays !== null &&
      answer.validityDays < opts.requires.validityDays
    ) {
      const held = heldUntil(answer, opts.quotedOn.get(answer.responseId) ?? null);
      out.push({
        kind: "validityShorterThanRequired",
        severity: "critical",
        supplierName: answer.supplierName,
        responseId: answer.responseId,
        clientSide: String(opts.requires.validityDays),
        supplierSide: String(answer.validityDays),
        detail: {
          shortBy: opts.requires.validityDays - answer.validityDays,
          heldUntil: held ? held.toISOString().slice(0, 10) : "",
          amount: opts.total(answer, opts.lineIds),
          currency: answer.currency,
        },
      });
    }

    // 2 — Lead time longer than the delivery deadline.
    //
    // "Choosing Vanne Algérie means missing the contractual delivery date and
    // exposing yourself to late penalties of 1‰ per day." Warning rather than
    // critical: it is a cost that can be priced in, not a promise that evaporates.
    if (
      opts.requires.deliveryDays !== null &&
      answer.leadTimeDays !== null &&
      answer.leadTimeDays > opts.requires.deliveryDays
    ) {
      out.push({
        kind: "leadTimeLongerThanRequired",
        severity: "warning",
        supplierName: answer.supplierName,
        responseId: answer.responseId,
        clientSide: String(opts.requires.deliveryDays),
        supplierSide: String(answer.leadTimeDays),
        detail: {
          lateBy: answer.leadTimeDays - opts.requires.deliveryDays,
          penalty: opts.requires.latePenalty ?? "",
        },
      });
    }

    // 3 — Quoting in a currency the client is not buying in.
    //
    // Not fatal and not rare: a European supplier quotes in euros for a dinar
    // contract. It becomes an exchange-rate risk somebody has to carry, and the
    // person who carries it should know before the offer goes out.
    if (answer.currency !== opts.requires.currency) {
      out.push({
        kind: "currencyDiffers",
        severity: "warning",
        supplierName: answer.supplierName,
        responseId: answer.responseId,
        clientSide: opts.requires.currency,
        supplierSide: answer.currency,
        detail: { from: answer.currency, to: opts.requires.currency },
      });
    }

    // 4 — Said "quoted", priced nothing.
    if (answer.prices.size === 0) {
      out.push({
        kind: "pricedNothing",
        severity: "warning",
        supplierName: answer.supplierName,
        responseId: answer.responseId,
        clientSide: String(opts.lineIds.length),
        supplierSide: "0",
        detail: {},
      });
    }
  }

  // Critical first: the screen shows them in that order and a person reading
  // top to bottom should meet the expensive one first.
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}

/**
 * Screen 67's reply-rate card.
 *
 * `bounced` is counted apart from `no_reply` deliberately. From a reply-rate
 * column they look identical; one is a supplier who is slow and the other is an
 * address that does not exist. Chasing the second forever is how a supplier
 * quietly drops out of every comparison for a year.
 */
export type ReplyRate = Record<ResponseStatus, number> & { asked: number };

export function replyRate(answers: SupplierAnswer[]): ReplyRate {
  const rate = { asked: answers.length, quoted: 0, declined: 0, no_reply: 0, bounced: 0 };
  for (const answer of answers) {
    if (answer.status !== "asked") rate[answer.status] += 1;
  }
  return rate;
}

/** Who is worth chasing: asked or silent, never bounced, never already answered. */
export function worthChasing(answers: SupplierAnswer[]): SupplierAnswer[] {
  return answers.filter((a) => a.status === "asked" || a.status === "no_reply");
}

/**
 * Screen 67's Buffer: how long between the supplier reply-by and the client's
 * own deadline.
 *
 * This is the number that decides whether a late supplier is an inconvenience
 * or a lost bid, and nobody computes it in their head at four o'clock on a
 * Thursday. Negative means the reply-by is AFTER the client's deadline, which
 * is a request that cannot help even if everybody answers on time.
 */
export function bufferHours(replyBy: Date | null, clientDeadline: Date | null): number | null {
  if (!replyBy || !clientDeadline) return null;
  return Math.floor((clientDeadline.getTime() - replyBy.getTime()) / 3_600_000);
}

/* ------------------------------------------------- comparing and splitting */

export type LineNeed = { lineId: string; qty: string };

/**
 * What one supplier would cost for a set of lines, or null if they did not
 * price all of them.
 *
 * Null rather than "the sum of what they did price" — and the difference
 * matters. A supplier who quoted four lines of five is not a cheaper single
 * source; they are not a single source at all, and adding up their four prices
 * produces a number that looks like a total and is not one. That number on a
 * comparison screen is how somebody places a purchase order for four fifths of
 * a job.
 */
export function totalFor(answer: SupplierAnswer, lines: LineNeed[]): string | null {
  let sum = new Decimal(0);
  for (const line of lines) {
    const price = answer.prices.get(line.lineId);
    if (price === undefined) return null;
    sum = sum.plus(new Decimal(price).times(new Decimal(line.qty)));
  }
  return sum.toDecimalPlaces(2).toFixed(2);
}

export type Comparison = {
  /** Per line: who is cheapest, and at what. */
  best: Map<string, { responseId: string; supplierName: string; unitPrice: string }>;
  /** The bill if every line is bought from whoever is cheapest on it. */
  splitTotal: string;
  /** How many suppliers that split involves. */
  splitSuppliers: number;
  /** The cheapest supplier who can do the WHOLE list, and what they cost. */
  singleBest: { responseId: string; supplierName: string; total: string } | null;
  /** What splitting saves against that single supplier. Null when nobody can
   *  do the whole list — there is nothing to save against. */
  saving: string | null;
  /** Lines nobody priced. Splitting cannot fix these. */
  unpricedLines: string[];
};

/**
 * Compare the quotes.
 *
 * Cheapest per line, then the two totals side by side. Screen 67 puts a
 * deliberate caveat next to the saving — "but adds a second delivery to
 * manage" — because the arithmetic is only half the decision: two suppliers
 * means two deliveries, two sets of paperwork, and two chances of one of them
 * being late against a penalty clause. This function does the arithmetic and
 * says how many suppliers the split needs; it does not recommend.
 */
export function compare(answers: SupplierAnswer[], lines: LineNeed[]): Comparison {
  const quoting = answers.filter((a) => a.status === "quoted");

  const best = new Map<string, { responseId: string; supplierName: string; unitPrice: string }>();
  const unpricedLines: string[] = [];

  for (const line of lines) {
    let winner: { responseId: string; supplierName: string; unitPrice: string } | null = null;
    for (const answer of quoting) {
      const price = answer.prices.get(line.lineId);
      if (price === undefined) continue;
      if (!winner || new Decimal(price).lessThan(new Decimal(winner.unitPrice))) {
        winner = {
          responseId: answer.responseId,
          supplierName: answer.supplierName,
          unitPrice: price,
        };
      }
    }
    if (winner) best.set(line.lineId, winner);
    else unpricedLines.push(line.lineId);
  }

  let splitTotal = new Decimal(0);
  for (const line of lines) {
    const winner = best.get(line.lineId);
    if (!winner) continue;
    splitTotal = splitTotal.plus(new Decimal(winner.unitPrice).times(new Decimal(line.qty)));
  }

  const splitSuppliers = new Set([...best.values()].map((w) => w.responseId)).size;

  let singleBest: Comparison["singleBest"] = null;
  for (const answer of quoting) {
    const total = totalFor(answer, lines);
    if (total === null) continue;
    if (!singleBest || new Decimal(total).lessThan(new Decimal(singleBest.total))) {
      singleBest = { responseId: answer.responseId, supplierName: answer.supplierName, total };
    }
  }

  // Only meaningful when one supplier could do the whole list AND the split
  // covers the whole list too. Comparing a partial split against a full single
  // source is comparing two different jobs.
  const saving =
    singleBest && unpricedLines.length === 0
      ? new Decimal(singleBest.total).minus(splitTotal).toDecimalPlaces(2).toFixed(2)
      : null;

  return {
    best,
    splitTotal: splitTotal.toDecimalPlaces(2).toFixed(2),
    splitSuppliers,
    singleBest,
    saving,
    unpricedLines,
  };
}
