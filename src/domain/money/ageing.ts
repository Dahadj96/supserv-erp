import Decimal from "decimal.js";

/**
 * Screen 20 — Ageing.
 *
 * The whole screen is LAW 1 in one page. `docs/PLAN.md` names it as one of two
 * bugs the rule found in the Figma file: **"overdue" was an invoice status.**
 * It is not a status. Nothing transitions an invoice to overdue; a date passes
 * while a balance is still owed, and that is arithmetic.
 *
 * The cost of getting this wrong is specific and this office would feel it: a
 * stored `overdue` flag needs a job to flip it, the job runs at midnight, and
 * on the morning somebody looks at the ageing report before the job has run,
 * every figure on it is a day stale — including the one they are about to
 * telephone a client about.
 *
 * Everything below takes `today` as an argument. Not for testing convenience:
 * so that there is no hidden clock anywhere, and the number on screen is the
 * number at the moment the page was drawn.
 */

const d = (value: string | null | undefined) => {
  const parsed = new Decimal(String(value ?? "0") || "0");
  return parsed.isFinite() ? parsed : new Decimal(0);
};

/**
 * Screen 20's four columns.
 *
 * TWO DIFFERENT CLOCKS RUN ON AN INVOICE, and this file keeps them apart:
 *
 *   AGE — days since it was ISSUED. This is what the buckets measure and what
 *   the Age column shows. It answers "how long has this money been out?", which
 *   is a question about the business, not about the client's behaviour.
 *
 *   LATENESS — days past the DUE date. This is what the relance policy runs on
 *   ("1st reminder — due + 7 days") and the only one that says the client has
 *   done anything wrong.
 *
 * An invoice issued sixty days ago on ninety-day terms is sixty days old and
 * not late by a single day. Both facts are true, both are worth seeing, and
 * collapsing them either flatters the ageing report or accuses a client who
 * paid exactly on time.
 *
 * Screen 20's own numbers settle which clock the buckets use: SUP/2026/0034 is
 * issued 12 Apr and shown as 128 d, which is days from ISSUE. All five rows and
 * all four bucket totals reconcile that way.
 */
export const BUCKETS = ["d0_30", "d31_60", "d61_90", "over90"] as const;
export type Bucket = (typeof BUCKETS)[number];

export type Owing = {
  documentId: string;
  number: string | null;
  partyId: string;
  clientName: string;
  issuedOn: Date | null;
  dueOn: Date | null;
  totalIncl: string;
  /** Sum of everything allocated against it. */
  paid: string;
  currency: string;
  /** When we last chased, of any kind. Null means never. */
  lastRelanceAt: Date | null;
};

/** What is still owed. Computed, never read from a column. */
export function balanceOf(owing: Pick<Owing, "totalIncl" | "paid">): string {
  return d(owing.totalIncl).minus(d(owing.paid)).toDecimalPlaces(2).toFixed(2);
}

/** How long the money has been out: days since the invoice was ISSUED. */
export function ageOf(issuedOn: Date | null, today: Date): number {
  if (!issuedOn) return 0;
  const days = Math.floor((today.getTime() - issuedOn.getTime()) / 86_400_000);
  return days > 0 ? days : 0;
}

/**
 * How late the CLIENT is: days past the due date. The relance clock.
 *
 * Zero when not yet due, and zero when there is no due date at all — chasing
 * somebody for missing a deadline nobody recorded would be inventing one.
 */
export function daysLate(dueOn: Date | null, today: Date): number {
  if (!dueOn) return 0;
  const days = Math.floor((today.getTime() - dueOn.getTime()) / 86_400_000);
  return days > 0 ? days : 0;
}

/** LAW 1 — nothing transitions an invoice to overdue. A date passes. */
export function isOverdue(
  owing: Pick<Owing, "dueOn" | "totalIncl" | "paid">,
  today: Date,
): boolean {
  return daysLate(owing.dueOn, today) > 0 && d(balanceOf(owing)).greaterThan(0);
}

/** Which column an invoice falls in, by age since issue. */
export function bucketOf(issuedOn: Date | null, today: Date): Bucket {
  const age = ageOf(issuedOn, today);
  if (age <= 30) return "d0_30";
  if (age <= 60) return "d31_60";
  if (age <= 90) return "d61_90";
  return "over90";
}

export type Ageing = {
  total: string;
  invoices: number;
  buckets: Record<Bucket, { amount: string; invoices: number; pct: string }>;
  /** Owed per client, biggest first. Screen 20's "By client". */
  byClient: { partyId: string; clientName: string; amount: string; pct: string }[];
};

/**
 * The ageing report.
 *
 * Only invoices with a balance greater than zero appear. A fully paid invoice
 * is not "0 outstanding" in the over-90 column; it is finished, and putting it
 * on this page with a zero would make the invoice COUNTS wrong, which is the
 * number people scan first.
 */
export function ageingOf(owings: Owing[], today: Date): Ageing {
  const unpaid = owings.filter((o) => d(balanceOf(o)).greaterThan(0));

  const buckets = Object.fromEntries(
    BUCKETS.map((b) => [b, { amount: new Decimal(0), invoices: 0 }]),
  ) as Record<Bucket, { amount: Decimal; invoices: number }>;

  const perClient = new Map<string, { clientName: string; amount: Decimal }>();
  let total = new Decimal(0);

  for (const owing of unpaid) {
    const balance = d(balanceOf(owing));
    total = total.plus(balance);

    const bucket = buckets[bucketOf(owing.issuedOn, today)];
    bucket.amount = bucket.amount.plus(balance);
    bucket.invoices += 1;

    const client = perClient.get(owing.partyId) ?? {
      clientName: owing.clientName,
      amount: new Decimal(0),
    };
    client.amount = client.amount.plus(balance);
    perClient.set(owing.partyId, client);
  }

  // Percentages against the TOTAL, and zero when nothing is owed — rather than
  // NaN, which is what dividing by an empty ledger gives you and what a person
  // sees on their first day using the system.
  const pctOf = (amount: Decimal) =>
    total.isZero() ? "0" : amount.dividedBy(total).times(100).toDecimalPlaces(0).toFixed(0);

  return {
    total: total.toDecimalPlaces(2).toFixed(2),
    invoices: unpaid.length,
    buckets: Object.fromEntries(
      BUCKETS.map((b) => [
        b,
        {
          amount: buckets[b].amount.toDecimalPlaces(2).toFixed(2),
          invoices: buckets[b].invoices,
          pct: pctOf(buckets[b].amount),
        },
      ]),
    ) as Ageing["buckets"],
    byClient: [...perClient.entries()]
      .map(([partyId, client]) => ({
        partyId,
        clientName: client.clientName,
        amount: client.amount.toDecimalPlaces(2).toFixed(2),
        pct: pctOf(client.amount),
      }))
      .sort((a, b) => Number(b.amount) - Number(a.amount)),
  };
}

/**
 * Screen 20's red banner: "No relance has been sent on SUP/2026/0034 for 34
 * days. It is 128 days old and is the single largest amount owed to SUPSERV."
 *
 * ONE invoice, not a list. A banner naming six things is a banner people scroll
 * past, and the whole point of it is to be the sentence somebody acts on before
 * their coffee.
 *
 * The choice is deliberately NOT "the oldest" or "the biggest". It is the one
 * where the most money has been sitting the longest with nobody doing anything
 * — old AND large AND untouched. An invoice chased yesterday is not neglected,
 * however old it is; somebody is already on it.
 */
export type Neglected = {
  documentId: string;
  number: string | null;
  clientName: string;
  amount: string;
  ageDays: number;
  /** Days since the last chase of any kind. Null when never chased. */
  silentDays: number | null;
  /** True when this is also the largest single amount owed. */
  isLargest: boolean;
};

/** Below this, an invoice is simply being processed, not neglected. */
export const SILENT_DAYS_BEFORE_NEGLECTED = 14;

export function mostNeglected(owings: Owing[], today: Date): Neglected | null {
  const unpaid = owings.filter(
    (o) => d(balanceOf(o)).greaterThan(0) && daysLate(o.dueOn, today) > 0,
  );
  if (unpaid.length === 0) return null;

  const silence = (o: Owing) =>
    o.lastRelanceAt === null
      ? daysLate(o.dueOn, today)
      : Math.floor((today.getTime() - o.lastRelanceAt.getTime()) / 86_400_000);

  const candidates = unpaid.filter((o) => silence(o) >= SILENT_DAYS_BEFORE_NEGLECTED);
  if (candidates.length === 0) return null;

  const largest = unpaid.reduce((best, o) =>
    d(balanceOf(o)).greaterThan(d(balanceOf(best))) ? o : best,
  );

  /**
   * Rank by amount × days of silence.
   *
   * Multiplying rather than ranking on either alone, because both matter and
   * neither dominates: five million untouched for a fortnight outranks eighty
   * thousand untouched for a year, and it should — that is where the money is.
   */
  const worst = candidates.reduce((best, o) =>
    d(balanceOf(o))
      .times(silence(o))
      .greaterThan(d(balanceOf(best)).times(silence(best)))
      ? o
      : best,
  );

  return {
    documentId: worst.documentId,
    number: worst.number,
    clientName: worst.clientName,
    amount: balanceOf(worst),
    ageDays: ageOf(worst.issuedOn, today),
    silentDays: worst.lastRelanceAt === null ? null : silence(worst),
    isLargest: worst.documentId === largest.documentId,
  };
}
