import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { numberingSeries } from "@/db/schema/document";

/**
 * Screen 70 — "Reserves the number: only on final issue, never on a preview."
 *
 * LAW 5. A number allocated to a draft that is then abandoned leaves a gap, and
 * a gap in an invoice series is a question from the tax office. So this is the
 * only place a number is produced, it runs inside the caller's transaction, and
 * it takes a row lock so two people pressing Issue at the same second cannot
 * receive the same number.
 */

export class NoSeries extends Error {
  constructor(readonly kind: string) {
    super("noSeriesForKind");
  }
}

export function formatNumber(pattern: string, value: number, year: number): string {
  return pattern
    .replace("{YYYY}", String(year))
    .replace("{YY}", String(year).slice(-2))
    .replace(/\{(#+)\}/, (_, hashes: string) => String(value).padStart(hashes.length, "0"));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Take the next number for a kind, inside a transaction.
 *
 * `for update` is the whole point: without it, two concurrent issues both read
 * next_value = 43 and both write 44, and two invoices go out as 0043. The lock
 * costs nothing at six users and is the difference between a series you can
 * defend and one you cannot.
 */
export type ReservedNumber = { number: string; seriesId: string };

export async function reserveNumber(tx: Tx, kind: string, on: Date): Promise<ReservedNumber> {
  const rows = await tx.execute<{
    id: string;
    pattern: string;
    next_value: number;
    reset: string;
    last_year: number | null;
  }>(sql`
    select id, pattern, next_value, reset,
           (select max(extract(year from issued_on))::int
            from document d where d.series_id = numbering_series.id) as last_year
    from numbering_series
    where kind = ${kind}
    for update
  `);

  const series = rows[0];
  if (!series) throw new NoSeries(kind);

  const year = on.getFullYear();

  // A yearly series restarts at 1 in January — but only once a document has
  // actually been issued in a previous year. Restarting because the clock
  // rolled over, on a series nobody used, would produce a second 0001.
  const restarts =
    series.reset === "yearly" && series.last_year !== null && series.last_year < year;
  const value = restarts ? 1 : series.next_value;

  await tx
    .update(numberingSeries)
    .set({ nextValue: value + 1 })
    .where(eq(numberingSeries.id, series.id));

  return {
    number: formatNumber(series.pattern, value, year),
    seriesId: series.id,
  };
}

/** What the next number WOULD be. Reserves nothing — screen 70 is explicit. */
export async function peekNumber(kind: string, on = new Date()): Promise<string | null> {
  const [series] = await db
    .select()
    .from(numberingSeries)
    .where(eq(numberingSeries.kind, kind))
    .limit(1);
  if (!series) return null;
  return formatNumber(series.pattern, series.nextValue, on.getFullYear());
}
