import Decimal from "decimal.js";

/**
 * THE ONLY PLACE A DOCUMENT TOTAL IS COMPUTED.
 *
 * Money is never a JavaScript number. `0.1 + 0.2` is 0.30000000000000004, and an
 * invoice that is off by one centime is an invoice a client will argue about.
 * Postgres stores numeric(16,2); this module works in Decimal; the UI formats
 * with Intl.NumberFormat. No other file multiplies a price by a quantity.
 */

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type Line = {
  qty: string | number;
  unitPrice: string | number;
  discountPct?: string | number;
  vatRate?: string | number; // 19 | 9 | 0
  isOption?: boolean;
};

/** What a retenue de garantie is taken on: the HT or the TTC of the document. */
export const RETENTION_BASES = ["excl", "incl"] as const;
export type RetentionBase = (typeof RETENTION_BASES)[number];

export type Totals = {
  totalExcl: string;
  discountTotal: string;
  vatByRate: Record<string, string>;
  totalVat: string;
  stampDuty: string;
  totalIncl: string;
  /** Already invoiced on an advance invoice, and deducted from what is due. */
  advanceDeducted: string;
  /**
   * Retenue de garantie withheld from THIS document. Zero unless the caller
   * said what it is taken on — see `retentionBase` on `computeTotals`.
   */
  retention: string;
  /**
   * Pénalités de retard, and what the client has already paid on the way.
   *
   * Both belong to ONE kind — the décompte final, which closes a marché by
   * subtracting everything from the value of the work. `computeTotals` never
   * sets them: a penalty is a figure the CCAP allows the client to apply, not
   * an arithmetic of ours, and money received is a fact of the payment
   * register. See `finalAccountOf`.
   */
  penalty?: string;
  alreadyPaid?: string;
  /** What the client actually has to pay on this document. */
  dueNow: string;
  /** Shown, never subtracted — see the note on `computeTotals`. */
  optionsExcl: string;
};

const D = (v: string | number | undefined, fallback = 0) =>
  new Decimal(v === undefined || v === null || v === "" ? fallback : v);

/** Line total excluding VAT, after its own discount. Options count for nothing. */
export function lineTotalExcl(line: Line): Decimal {
  if (line.isOption) return new Decimal(0);
  const gross = D(line.qty).times(D(line.unitPrice));
  const discount = gross.times(D(line.discountPct).div(100));
  return gross.minus(discount).toDecimalPlaces(2);
}

/**
 * VAT is computed per rate, not on the grand total — a document with 19% and 9%
 * lines must show two VAT lines, and an Algerian invoice is expected to.
 */
export function computeTotals(
  lines: Line[],
  opts: {
    globalDiscountPct?: string | number;
    stampDuty?: string | number;
    /** Screen 47 — "Advance already invoiced". Deducted from what is due. */
    advanceDeducted?: string | number;
    /**
     * Retenue de garantie, in percent, and WHAT IT IS TAKEN ON. Nothing is
     * withheld unless both are given: the percentage alone is printed on
     * offers and orders as a term of the contract, and only a situation —
     * whose project has read the CCAP and said `excl` or `incl` — asks for the
     * arithmetic. `incl` is the sum including VAT and excluding the droit de
     * timbre, which is a tax on the payment and not part of the work.
     */
    retentionPct?: string | number;
    retentionBase?: RetentionBase | null;
  } = {},
): Totals {
  let subtotal = new Decimal(0);
  let optionsExcl = new Decimal(0);
  const buckets = new Map<string, Decimal>();

  for (const line of lines) {
    // Screen 47 — "options are not counted". An option is priced and printed so
    // the client can see what they did not buy, and it is added to nothing.
    if (line.isOption) {
      const gross = D(line.qty).times(D(line.unitPrice));
      optionsExcl = optionsExcl.plus(
        gross.minus(gross.times(D(line.discountPct).div(100))).toDecimalPlaces(2),
      );
      continue;
    }

    const excl = lineTotalExcl(line);
    subtotal = subtotal.plus(excl);
    const rate = D(line.vatRate).toFixed(2);
    buckets.set(rate, (buckets.get(rate) ?? new Decimal(0)).plus(excl));
  }

  const globalPct = D(opts.globalDiscountPct);
  const discountTotal = subtotal.times(globalPct.div(100)).toDecimalPlaces(2);
  const totalExcl = subtotal.minus(discountTotal).toDecimalPlaces(2);

  // A global discount reduces every VAT base proportionally, or the two disagree.
  const factor = subtotal.isZero() ? new Decimal(1) : totalExcl.div(subtotal);

  const vatByRate: Record<string, string> = {};
  let totalVat = new Decimal(0);
  for (const [rate, base] of buckets) {
    const vat = base.times(factor).times(new Decimal(rate).div(100)).toDecimalPlaces(2);
    vatByRate[rate] = vat.toFixed(2);
    totalVat = totalVat.plus(vat);
  }

  const stampDuty = D(opts.stampDuty).toDecimalPlaces(2);
  const totalIncl = totalExcl.plus(totalVat).plus(stampDuty).toDecimalPlaces(2);

  // An advance already invoiced was already taxed on its own invoice, so it
  // comes off the total INCLUDING VAT, not off the base. `totalIncl` stays the
  // value of the work; `dueNow` is what the client pays on this piece of paper.
  const advanceDeducted = D(opts.advanceDeducted).toDecimalPlaces(2);

  // Retenue de garantie is a WITHHOLDING, not a discount. The client owes the
  // whole sum and keeps part of it back until the warranty runs out, so it
  // never reduces the VAT base and comes off what is due on this paper only —
  // the same place an advance already invoiced comes off. Which sum the
  // percentage is applied to is the contract's fact (see `retentionBase`),
  // and this file computes nothing until a person has said which.
  const retention =
    opts.retentionBase && D(opts.retentionPct).greaterThan(0)
      ? (opts.retentionBase === "incl" ? totalExcl.plus(totalVat) : totalExcl)
          .times(D(opts.retentionPct).div(100))
          .toDecimalPlaces(2)
      : new Decimal(0);

  const dueNow = totalIncl.minus(advanceDeducted).minus(retention).toDecimalPlaces(2);

  return {
    totalExcl: totalExcl.toFixed(2),
    discountTotal: discountTotal.toFixed(2),
    vatByRate,
    totalVat: totalVat.toFixed(2),
    stampDuty: stampDuty.toFixed(2),
    totalIncl: totalIncl.toFixed(2),
    advanceDeducted: advanceDeducted.toFixed(2),
    retention: retention.toFixed(2),
    dueNow: dueNow.toFixed(2),
    optionsExcl: optionsExcl.toFixed(2),
  };
}

/** Balance is COMPUTED, never stored. LAW 1. */
export function balance(totalIncl: string, paid: string): string {
  return new Decimal(totalIncl).minus(new Decimal(paid)).toDecimalPlaces(2).toFixed(2);
}

/**
 * "1 234 567,89 DZD" in fr, "1,234,567.89 DZD" in en.
 *
 * Locale and currency are NAMED, not positional. They used to be two adjacent
 * string parameters, and three call sites passed them the wrong way round —
 * `formatMoney(value, "DZD", locale)` — which typechecks perfectly and renders
 * amounts in a currency called "fr". Two strings in a row that mean different
 * things is a trap, so the trap is removed rather than documented.
 */
export function formatMoney(
  amount: string,
  { locale, currency = "DZD" }: { locale: string; currency?: string },
): string {
  return new Intl.NumberFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(Number(amount));
}
