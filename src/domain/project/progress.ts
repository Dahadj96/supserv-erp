import Decimal from "decimal.js";

/**
 * Screens 15 and 16 — what a project is worth today, and what is holding it up.
 *
 * PURE. Situations in, money out. `now` is an argument, because every
 * interesting question on this screen is about a date in the future: does the
 * caution outlive the réception provisoire, has this situation been sitting
 * unsigned for three weeks, when does the retention come back.
 */

export const PROJECT_STATES = ["active", "warranty", "closed"] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];

export const SITUATION_STATES = ["draft", "submitted", "approved", "paid"] as const;
export type SituationState = (typeof SITUATION_STATES)[number];

export type SituationInput = {
  documentId: string;
  sequence: number;
  /** Null while it is still a draft — LAW 5, a number arrives at issue. */
  number: string | null;
  amountExcl: string;
  submittedOn: string | null;
  approvedOn: string | null;
  /** What has been allocated against the invoice this situation became. */
  paid: string;
};

export type Situation = SituationInput & {
  state: SituationState;
  /** What the client keeps back from THIS situation. */
  retention: string;
  /** Days since it was submitted and not yet approved. Null when it has been. */
  waitingDays: number | null;
};

const DAY = 86_400_000;

function days(from: string, to: Date): number {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((end - start) / DAY);
}

function d(value: string | null | undefined): Decimal {
  return new Decimal(value ?? "0");
}

/**
 * A situation nobody has signed is not progress.
 *
 * `submitted` and `approved` are different facts and the gap between them is
 * where the money sits: screen 15's banner is "situation n°3 has been with
 * SADEG for 21 days without approval, payment cannot start until it is signed".
 * A single `status` column would have collapsed the two dates that make that
 * sentence possible.
 */
export function situationState(input: SituationInput): SituationState {
  if (Number(input.paid) > 0) return "paid";
  if (input.approvedOn) return "approved";
  if (input.submittedOn && input.number) return "submitted";
  return "draft";
}

export function readSituation(input: SituationInput, retentionPct: string, now: Date): Situation {
  const state = situationState(input);
  return {
    ...input,
    state,
    retention: d(input.amountExcl).times(d(retentionPct)).dividedBy(100).toFixed(2),
    waitingDays:
      state === "submitted" && input.submittedOn ? Math.max(days(input.submittedOn, now), 0) : null,
  };
}

export type Money = {
  /** The contract, excluding VAT. */
  contract: string;
  /** Billed and signed off by the client. */
  approved: string;
  /** Submitted and waiting for a signature. Not progress, and not nothing. */
  awaitingApproval: string;
  /** Held back across every approved situation. */
  retentionHeld: string;
  /**
   * Of that, what the client has actually GIVEN BACK — money allocated against
   * an issued levée de retenue de garantie.
   *
   * Money arriving is what ends a warranty, not a demand being sent. A demand
   * sitting unanswered on a wilaya's desk for eight months is precisely the
   * state screen 15 exists to show, and calling the marché closed because we
   * asked would hide it.
   */
  retentionReleased: string;
  /** Still with the client: held less released. What is worth going after. */
  retentionOutstanding: string;
  /** Actually received. */
  paid: string;
  /** Contract less what has been approved. */
  remaining: string;
};

export type Progress = {
  situations: Situation[];
  money: Money;
  /** Approved over contract, whole percent, floored. Null with no contract. */
  financialPercent: number | null;
  /** What a person said. Never derived. */
  physicalPercent: number | null;
  /**
   * Work done and not yet billed, in percentage points. Positive means the
   * company has spent money it has not asked for. Null unless both are known.
   */
  aheadOfBilling: number | null;
  /** The longest a submitted situation has been waiting. */
  longestWait: Situation | null;
};

/** How long a signature may sit before it is worth a banner. */
export const WAITING_TOO_LONG_DAYS = 14;

export function progressOf(opts: {
  situations: SituationInput[];
  contract: string | null;
  retentionPct: string;
  /** What the client has given back. Zero until a levée is paid. */
  retentionReleased?: string;
  physicalPercent: number | null;
  now: Date;
}): Progress {
  const situations = opts.situations
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((s) => readSituation(s, opts.retentionPct, opts.now));

  const sum = (rows: Situation[], pick: (s: Situation) => Decimal) =>
    rows.reduce((total, row) => total.plus(pick(row)), new Decimal(0));

  const approvedRows = situations.filter((s) => s.state === "approved" || s.state === "paid");
  const waitingRows = situations.filter((s) => s.state === "submitted");

  const contract = opts.contract ? d(opts.contract) : null;
  const approved = sum(approvedRows, (s) => d(s.amountExcl));

  /**
   * Retention is held on APPROVED situations only.
   *
   * A situation the client has not signed has had nothing withheld from it,
   * because nothing has been agreed. Counting it would overstate what is
   * waiting to come back at the end of the warranty, which is a figure people
   * plan around.
   */
  const retentionHeld = sum(approvedRows, (s) => d(s.retention));
  const retentionReleased = d(opts.retentionReleased);
  const retentionOutstanding = Decimal.max(retentionHeld.minus(retentionReleased), 0);

  const financialPercent =
    contract && contract.greaterThan(0)
      ? Math.min(Math.floor(approved.dividedBy(contract).times(100).toNumber()), 100)
      : null;

  const aheadOfBilling =
    financialPercent !== null && opts.physicalPercent !== null
      ? opts.physicalPercent - financialPercent
      : null;

  const longestWait =
    waitingRows.length === 0
      ? null
      : waitingRows.reduce((worst, row) =>
          (row.waitingDays ?? 0) > (worst.waitingDays ?? 0) ? row : worst,
        );

  return {
    situations,
    money: {
      contract: contract ? contract.toFixed(2) : "0.00",
      approved: approved.toFixed(2),
      awaitingApproval: sum(waitingRows, (s) => d(s.amountExcl)).toFixed(2),
      retentionHeld: retentionHeld.toFixed(2),
      retentionReleased: retentionReleased.toFixed(2),
      retentionOutstanding: retentionOutstanding.toFixed(2),
      paid: sum(situations, (s) => d(s.paid)).toFixed(2),
      remaining: contract ? Decimal.max(contract.minus(approved), 0).toFixed(2) : "0.00",
    },
    financialPercent,
    physicalPercent: opts.physicalPercent,
    aheadOfBilling,
    longestWait,
  };
}

/**
 * When the retention comes back.
 *
 * The délai de garantie runs from the réception PROVISOIRE and ends at the
 * réception DÉFINITIVE. So the two cases are not the same arithmetic:
 *
 *   - No PV définitif yet: the date is a PROJECTION, provisoire + warranty. The
 *     screen labels it "expected", because a projection presented as a promise
 *     is how somebody plans a year around a date nobody has set.
 *   - PV définitif signed: the warranty has already run. The date is the PV
 *     itself — the day the right to ask for the money back opened.
 *
 * It read `définitif + warranty` until screen 16e was written, which put the
 * release a second year out and told the Gérant to sit on a demand he was
 * already entitled to send. How long the wilaya then takes to pay is the
 * ageing screen's business, from the date the demand was issued; a délai
 * réglementaire is a legal claim and this screen makes none.
 */
export function retentionRelease(opts: {
  pvProvisoireOn: string | null;
  pvDefinitiveOn: string | null;
  warrantyMonths: number | null;
}): { on: string | null; basis: "definitive" | "provisional" | "unknown" } {
  if (opts.pvDefinitiveOn) return { on: opts.pvDefinitiveOn, basis: "definitive" };

  if (!opts.warrantyMonths) return { on: null, basis: "unknown" };
  if (!opts.pvProvisoireOn) return { on: null, basis: "unknown" };

  const at = new Date(`${opts.pvProvisoireOn}T00:00:00Z`);
  at.setUTCMonth(at.getUTCMonth() + opts.warrantyMonths);

  return { on: at.toISOString().slice(0, 10), basis: "provisional" };
}

export function projectState(opts: {
  closedAt: Date | null;
  pvProvisoireOn: string | null;
  /**
   * What the client is STILL holding — `money.retentionOutstanding`, not
   * `retentionHeld`. Held never falls: it is the sum of what the situations
   * withheld, and an issued situation cannot change. Reading it here meant no
   * marché could ever leave the warranty, however much money came back.
   */
  retentionHeld: string;
}): ProjectState {
  if (opts.closedAt) return "closed";
  /**
   * Warranty, not closed, and the distinction is money. The work is finished
   * and accepted; the client is still holding the retention. A project marked
   * closed at provisional acceptance is a project whose 640 000 DZD nobody goes
   * back for.
   */
  if (opts.pvProvisoireOn && Number(opts.retentionHeld) > 0) return "warranty";
  if (opts.pvProvisoireOn) return "closed";
  return "active";
}
