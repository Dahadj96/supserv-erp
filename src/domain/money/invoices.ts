import Decimal from "decimal.js";
import { ageOf, balanceOf, bucketOf, daysLate, type Owing } from "./ageing";

/**
 * Screen 17 — Invoices, once payments exist.
 *
 * The page shipped earlier with a note at the foot of the table saying the
 * Paid column would arrive with the payments module rather than showing a
 * column of zeroes that meant nothing. It has arrived, and this file is what
 * the column reads from.
 *
 * PAID IS NOT A STATUS. The frame draws Draft, Issued, Partly paid, Paid, and
 * it is tempting to store all five in `document.status` — the table already
 * has the column. Three of those five are facts about the document (it is a
 * draft, it was issued, it was credited); two are arithmetic over payment
 * allocations that changes without anybody touching the document. Storing them
 * together means a transition somebody has to remember to fire, and the first
 * time a payment is recorded through a screen that forgets, an invoice sits at
 * "Issued" with its balance at zero. So `status` keeps what the document IS,
 * and paid-ness is computed here every time the page is drawn.
 */

const d = (value: string | null | undefined) => {
  const parsed = new Decimal(String(value ?? "0") || "0");
  return parsed.isFinite() ? parsed : new Decimal(0);
};

/**
 * What the Status column says.
 *
 * `noLegalValue` is the proforma. It is not unpaid and it is not awaiting
 * anything — a proforma is a quotation dressed as an invoice, and screen 18's
 * whole point is that only the real thing carries the décret 05-468 mentions.
 * Counting one as owed money would inflate every figure on screens 17 and 20.
 */
export const PAID_STATES = [
  "draft",
  "noLegalValue",
  "unpaid",
  "partPaid",
  "paid",
  "credited",
  "writtenOff",
] as const;
export type PaidState = (typeof PAID_STATES)[number];

export type InvoiceFacts = {
  kind: string;
  /** What the document itself records: draft | issued | credited | written_off. */
  status: string;
  /** Null until it is issued. LAW 5 — the number IS the issue. */
  number: string | null;
  totalIncl: string;
  /** Sum of everything allocated against it. */
  paid: string;
};

export function paidStateOf(facts: InvoiceFacts): PaidState {
  if (facts.kind === "proforma") return "noLegalValue";
  // A document with no number has never been issued, whatever its status says.
  if (!facts.number || facts.status === "draft") return "draft";
  if (facts.status === "credited") return "credited";
  if (facts.status === "written_off") return "writtenOff";

  const total = d(facts.totalIncl);
  const paid = d(facts.paid);
  // Greater-or-equal, not equal: an overpayment of eighty centimes is paid,
  // and an invoice that will not go green until somebody hand-edits a figure
  // is an invoice somebody hand-edits.
  if (total.greaterThan(0) && paid.greaterThanOrEqualTo(total)) return "paid";
  if (paid.greaterThan(0)) return "partPaid";
  return "unpaid";
}

/** Still owed money: the states that carry a balance somebody should chase. */
export function isOwing(state: PaidState): boolean {
  return state === "unpaid" || state === "partPaid";
}

/**
 * Screen 17's red banner:
 *
 *   "2 invoices are past 90 days with URBACON and GCB, totalling 8 240 000 DZD.
 *    No relance has been sent in 34 days."
 *
 * Three facts, and each is a different question: how much is very old, whose it
 * is, and how long nobody has done anything. The last is the one that makes it
 * a banner rather than a statistic — 8 240 000 sitting for three months is a
 * problem; 8 240 000 sitting for three months with somebody actively working it
 * is a Tuesday.
 *
 * Named clients rather than a count, because "2 invoices past 90 days" is a
 * number to scroll past and "URBACON and GCB" is a name to telephone.
 */
export type Over90 = {
  invoices: number;
  clients: string[];
  amount: string;
  /**
   * Days since the most recent chase of any of them. Null when not one of them
   * has ever been chased, which is a different and worse fact.
   */
  silentDays: number | null;
};

export function over90(owings: Owing[], today: Date): Over90 | null {
  const old = owings.filter(
    (o) => d(balanceOf(o)).greaterThan(0) && bucketOf(o.issuedOn, today) === "over90",
  );
  if (old.length === 0) return null;

  const amount = old.reduce((sum, o) => sum.plus(d(balanceOf(o))), new Decimal(0));

  const chased = old
    .map((o) => o.lastRelanceAt)
    .filter((at): at is Date => at !== null)
    .map((at) => Math.floor((today.getTime() - at.getTime()) / 86_400_000));

  return {
    invoices: old.length,
    clients: [...new Set(old.map((o) => o.clientName))].sort(),
    amount: amount.toDecimalPlaces(2).toFixed(2),
    // The most RECENT chase across the group. One of them being chased
    // yesterday is the honest answer to "has anybody done anything".
    silentDays: chased.length === 0 ? null : Math.min(...chased),
  };
}

/** One row of screen 17's table, with both clocks and the derived state. */
export type InvoiceRow = {
  state: PaidState;
  balance: string;
  /** Days since issue — the Age column. */
  ageDays: number;
  /** Days past due — what makes the Age column say "· overdue". */
  lateDays: number;
};

export function rowOf(owing: Owing, facts: InvoiceFacts, today: Date): InvoiceRow {
  return {
    state: paidStateOf(facts),
    balance: balanceOf(owing),
    ageDays: ageOf(owing.issuedOn, today),
    lateDays: daysLate(owing.dueOn, today),
  };
}
