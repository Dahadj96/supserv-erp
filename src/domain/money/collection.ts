import Decimal from "decimal.js";

/**
 * Screen 19 — "Quarter to date": received, still to collect, average days to
 * pay, best payer, worst payer.
 *
 * THE DECISION THIS FILE TURNS ON: an invoice that has not been paid still
 * counts towards how long a client takes to pay.
 *
 * The obvious implementation averages settled invoices only — you cannot know
 * how long something took until it is over. It is also the implementation that
 * makes the frame's own figure impossible: URBACON is the worst payer at 128
 * days, and URBACON's 128 days is screen 20's oldest UNPAID invoice. Nothing
 * has been settled, so a settled-only average would leave the worst payer in
 * the company off the list entirely.
 *
 * That is not a coincidence in the mockup, it is the point. A client who has
 * owed you money for 128 days has told you something about how they pay, and
 * the number is not unknown — it is AT LEAST 128 and rising. Excluding them
 * ranks the client who never pays above the client who pays in ninety days,
 * which is the exact opposite of the truth, and does it on the one screen where
 * somebody decides whether to extend more credit.
 *
 * So an unpaid invoice contributes days-since-issue, and `stillRunning` counts
 * how many of the figures are lower bounds, so the screen can say so rather
 * than presenting a moving number as a settled one.
 */

const d = (value: string | null | undefined) => {
  const parsed = new Decimal(String(value ?? "0") || "0");
  return parsed.isFinite() ? parsed : new Decimal(0);
};

const DAY = 86_400_000;

export type Settlement = {
  documentId: string;
  partyId: string;
  clientName: string;
  issuedOn: Date | null;
  /**
   * The day the payment that cleared the last of it arrived. Null while any
   * balance remains — including when part of it has been paid, because a client
   * who pays half in a week and the rest in four months took four months.
   */
  settledOn: Date | null;
};

export type Elapsed = {
  days: number;
  /** False when the clock is still running: the number is a floor, not a fact. */
  settled: boolean;
};

/**
 * How long this invoice took, or has taken so far.
 *
 * Null when it was never issued — there is no clock to start. Zero-floored:
 * a payment recorded with a date before the invoice's is somebody's typo, and
 * negative days on a report is a worse answer than nought.
 */
export function elapsedOf(settlement: Settlement, today: Date): Elapsed | null {
  if (!settlement.issuedOn) return null;
  const end = settlement.settledOn ?? today;
  const days = Math.floor((end.getTime() - settlement.issuedOn.getTime()) / DAY);
  return { days: days > 0 ? days : 0, settled: settlement.settledOn !== null };
}

export type Payer = {
  partyId: string;
  clientName: string;
  /** Mean days across every issued invoice, settled or still running. */
  averageDays: number;
  invoices: number;
  /** How many of those are still unpaid, so the average is a lower bound. */
  stillRunning: number;
};

/** One row per client, slowest last. */
export function payers(settlements: Settlement[], today: Date): Payer[] {
  const perClient = new Map<
    string,
    { clientName: string; total: number } & Omit<Payer, "partyId" | "clientName" | "averageDays">
  >();

  for (const settlement of settlements) {
    const elapsed = elapsedOf(settlement, today);
    if (!elapsed) continue;

    const row = perClient.get(settlement.partyId) ?? {
      clientName: settlement.clientName,
      total: 0,
      invoices: 0,
      stillRunning: 0,
    };
    row.total += elapsed.days;
    row.invoices += 1;
    if (!elapsed.settled) row.stillRunning += 1;
    perClient.set(settlement.partyId, row);
  }

  return [...perClient.entries()]
    .map(([partyId, row]) => ({
      partyId,
      clientName: row.clientName,
      averageDays: Math.round(row.total / row.invoices),
      invoices: row.invoices,
      stillRunning: row.stillRunning,
    }))
    .sort((a, b) => a.averageDays - b.averageDays || a.clientName.localeCompare(b.clientName));
}

export type Received = { amount: string; currency: string };

export type Collection = {
  /** Money that arrived in the period, in DZD. */
  received: string;
  /** How many payments that was. The frame's "7 recorded this quarter". */
  payments: number;
  /** What is still owed across everything — screen 20's total. */
  stillToCollect: string;
  /** Mean days to pay across every client. Null when nothing has been issued. */
  averageDaysToPay: number | null;
  best: Payer | null;
  worst: Payer | null;
  /** Invoices whose clock is still running, across all clients. */
  stillRunning: number;
  /**
   * Currencies other than DZD seen in the period. `received` deliberately does
   * NOT add them up: adding euros to dinars at no stated rate produces a number
   * that is wrong in a way nobody can see. The screen names them instead.
   */
  otherCurrencies: string[];
};

export function collectionOf(opts: {
  received: Received[];
  /** Total outstanding, already computed by the ageing report. */
  stillToCollect: string;
  settlements: Settlement[];
  today: Date;
}): Collection {
  const dinars = opts.received.filter((r) => r.currency.toUpperCase() === "DZD");
  const received = dinars.reduce((sum, r) => sum.plus(d(r.amount)), new Decimal(0));

  const otherCurrencies = [
    ...new Set(
      opts.received.map((r) => r.currency.toUpperCase()).filter((currency) => currency !== "DZD"),
    ),
  ].sort();

  const ranked = payers(opts.settlements, opts.today);
  const weighted = ranked.reduce(
    (acc, payer) => ({
      days: acc.days + payer.averageDays * payer.invoices,
      invoices: acc.invoices + payer.invoices,
    }),
    { days: 0, invoices: 0 },
  );

  return {
    received: received.toDecimalPlaces(2).toFixed(2),
    // Every payment counts as recorded, whatever currency it arrived in.
    payments: opts.received.length,
    stillToCollect: d(opts.stillToCollect).toDecimalPlaces(2).toFixed(2),
    averageDaysToPay:
      weighted.invoices === 0 ? null : Math.round(weighted.days / weighted.invoices),
    // With one client there is no best and worst, there is just the client.
    best: ranked.length > 1 ? (ranked[0] ?? null) : null,
    worst: ranked.length > 1 ? (ranked[ranked.length - 1] ?? null) : null,
    stillRunning: ranked.reduce((sum, payer) => sum + payer.stillRunning, 0),
    otherCurrencies,
  };
}
