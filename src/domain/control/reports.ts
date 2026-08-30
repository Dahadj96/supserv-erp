import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { deal } from "@/db/schema/deal";
import { document } from "@/db/schema/document";
import { ageingOf } from "@/domain/money/ageing";
import { owings } from "@/domain/money/store";

/**
 * Screen 28 — Reports.
 *
 * Everything here is computed at the moment the page is drawn. There is no
 * report table, no nightly rollup and no cached figure, which is LAW 1 applied
 * to the one place it is most tempting to break: a summary is exactly the sort
 * of thing somebody wants to precompute, and a precomputed summary is a number
 * that can disagree with the rows it claims to summarise.
 *
 * The cost is real — these are aggregate queries and they run every view. At
 * six users and a few thousand documents that cost is nothing, and when it
 * stops being nothing the fix is an index, not a stored total.
 *
 * Every figure also says what it counted. "Revenue: 0" and "no invoices have
 * been issued yet" are different statements, and a report that cannot tell them
 * apart is a report that gets ignored the first time it is wrong.
 */

export type MonthRow = { month: string; count: number; total: string };

/** Issued documents by month and kind. Drafts are not sales. */
export async function issuedByMonth(kind: string, months = 12): Promise<MonthRow[]> {
  const rows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${document.issuedOn}::date), 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum((${document.totals}->>'totalIncl')::numeric), 0)::text`,
    })
    .from(document)
    .where(
      and(
        eq(document.kind, kind),
        isNotNull(document.number),
        isNotNull(document.issuedOn),
        sql`${document.issuedOn}::date > current_date - make_interval(months => ${months})`,
      ),
    )
    .groupBy(sql`date_trunc('month', ${document.issuedOn}::date)`)
    .orderBy(desc(sql`date_trunc('month', ${document.issuedOn}::date)`));

  return rows;
}

export type KindRow = { kind: string; issued: number; drafts: number };

/** What this company actually produces, by document kind. */
export async function byKind(): Promise<KindRow[]> {
  return db
    .select({
      kind: document.kind,
      issued: sql<number>`count(*) filter (where ${document.number} is not null)::int`,
      drafts: sql<number>`count(*) filter (where ${document.status} = 'draft')::int`,
    })
    .from(document)
    .groupBy(document.kind)
    .orderBy(desc(sql`count(*)`));
}

export type DealOutcomes = {
  total: number;
  won: number;
  lost: number;
  noBid: number;
  open: number;
};

/**
 * How enquiries ended.
 *
 * `won` is not a column and never will be — winning is an order arriving, and
 * `src/domain/deal/stage.ts` computes it from documents. So this counts orders
 * rather than reading a flag somebody had to remember to tick.
 */
export async function dealOutcomes(): Promise<DealOutcomes> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      lost: sql<number>`count(*) filter (where ${deal.lostAt} is not null)::int`,
      noBid: sql<number>`count(*) filter (where ${deal.decision} = 'no_bid')::int`,
      won: sql<number>`count(*) filter (where exists (
        select 1 from ${document} d
        where d.deal_id = ${deal.id} and d.kind = 'client_order'
      ))::int`,
    })
    .from(deal)
    .where(sql`${deal.deletedAt} is null`);

  const total = row?.total ?? 0;
  const won = row?.won ?? 0;
  const lost = row?.lost ?? 0;
  const noBid = row?.noBid ?? 0;

  return { total, won, lost, noBid, open: Math.max(0, total - won - lost - noBid) };
}

export type Report = {
  invoices: MonthRow[];
  offers: MonthRow[];
  kinds: KindRow[];
  deals: DealOutcomes;
  ageing: Awaited<ReturnType<typeof ageingOf>>;
  /** Nothing has ever been issued. Told apart from "issued nothing this year". */
  everIssued: boolean;
};

export async function report(today = new Date()): Promise<Report> {
  const [invoices, offers, kinds, deals, owed] = await Promise.all([
    issuedByMonth("invoice"),
    issuedByMonth("offer"),
    byKind(),
    dealOutcomes(),
    owings(),
  ]);

  return {
    invoices,
    offers,
    kinds,
    deals,
    ageing: ageingOf(owed, today),
    everIssued: kinds.some((k) => k.issued > 0),
  };
}
