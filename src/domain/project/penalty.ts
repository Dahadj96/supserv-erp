import Decimal from "decimal.js";

/**
 * Pénalités de retard — what the CCAP's clause comes to, and nothing else.
 *
 * This function computes a figure the CLIENT may apply against us. It is not
 * withheld by this system, never deducted from a situation, and never printed
 * on a document we issue: the wilaya applies it on the décompte général, and
 * an ERP that quietly billed itself a penalty would be inventing a debt.
 *
 * It refuses to produce a number until a person has read the clause off the
 * CCAP — the rate, the ceiling, and which amount they are taken on. That is
 * the same rule the retention follows and the same rule the droit de timbre
 * follows: no legal claim without an authority and somebody who confirmed it.
 *
 * The count runs from the contractual end AS THE AVENANTS LEFT IT, to the
 * réception provisoire — the day the work was accepted — or to today while it
 * has not been accepted, in which case the figure is still growing and the
 * screen says so rather than presenting it as settled.
 */

export const PENALTY_BASES = ["excl", "incl"] as const;
export type PenaltyBase = (typeof PENALTY_BASES)[number];

export type PenaltyInput = {
  /** Per mille of the marché, per day. Null until somebody has read the CCAP. */
  perMille: string | null;
  /** The ceiling, as a percentage of the marché. Null likewise. */
  capPct: string | null;
  base: PenaltyBase | null;
  /** The marché as its avenants left it, excluding VAT. */
  contractExcl: string | null;
  /**
   * The marché INCLUDING VAT, when the clause is taken on the TTC. Null when
   * the bordereau carries no VAT anybody has computed — the clause then has
   * nothing to be taken on and says so rather than guessing a rate.
   */
  contractIncl: string | null;
  /** The contractual end, as the avenants left it. */
  deadline: string | null;
  /** Réception provisoire. Null while the work has not been accepted. */
  receivedOn: string | null;
  /** Today, as an ISO date. */
  on: string;
};

export type PenaltyView = {
  /** Why there is no figure, when there is none. */
  blocked: "noClause" | "noDeadline" | "noAmount" | null;
  /** The date the count runs to: the réception, or today. */
  countedTo: string | null;
  /** Zero on a project delivered on time — which is a fact worth printing. */
  daysLate: number;
  /** What the clause is taken on, formatted as a plain decimal. */
  basis: string | null;
  /** Rate × days × basis, before the ceiling. */
  raw: string | null;
  /** The ceiling itself. */
  cap: string | null;
  /** The lesser of the two: what the clause actually allows. */
  amount: string | null;
  /** True when the arithmetic hit the ceiling. */
  capped: boolean;
  /**
   * True while the work has not been accepted: the count is still running and
   * the figure below is what it stands at today, not what it will be.
   */
  stillRunning: boolean;
};

const NOTHING: PenaltyView = {
  blocked: null,
  countedTo: null,
  daysLate: 0,
  basis: null,
  raw: null,
  cap: null,
  amount: null,
  capped: false,
  stillRunning: false,
};

/** Whole days from `from` to `to`, never negative. Dates, not timestamps. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function asPenaltyBase(value: string | null | undefined): PenaltyBase | null {
  return (PENALTY_BASES as readonly string[]).includes(value ?? "") ? (value as PenaltyBase) : null;
}

export function penaltyOf(input: PenaltyInput): PenaltyView {
  const readable =
    input.perMille !== null &&
    input.perMille !== "" &&
    input.capPct !== null &&
    input.capPct !== "" &&
    input.base !== null;
  if (!readable) return { ...NOTHING, blocked: "noClause" };
  if (!input.deadline) return { ...NOTHING, blocked: "noDeadline" };

  const basis = input.base === "incl" ? input.contractIncl : input.contractExcl;
  if (!basis || new Decimal(basis).lessThanOrEqualTo(0)) {
    return { ...NOTHING, blocked: "noAmount" };
  }

  const countedTo = input.receivedOn ?? input.on;
  const daysLate = daysBetween(input.deadline, countedTo);

  const b = new Decimal(basis);
  const raw = b
    .times(new Decimal(input.perMille as string).div(1000))
    .times(daysLate)
    .toDecimalPlaces(2);
  const cap = b.times(new Decimal(input.capPct as string).div(100)).toDecimalPlaces(2);
  const capped = raw.greaterThan(cap);

  return {
    blocked: null,
    countedTo,
    daysLate,
    basis: b.toFixed(2),
    raw: raw.toFixed(2),
    cap: cap.toFixed(2),
    amount: (capped ? cap : raw).toFixed(2),
    capped,
    stillRunning: !input.receivedOn && daysLate > 0,
  };
}
