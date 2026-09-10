import { and, desc, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { deal } from "@/db/schema/deal";
import { document } from "@/db/schema/document";
import { liveDocument } from "@/domain/deletion";
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

/** What screen 28's two charts count. Exported so a test can hold them against
 *  the catalogue: a kind that does not exist draws a flat line for ever. */
export const INVOICED_KINDS = ["invoice"];
export const OFFER_KINDS = ["quotation", "proforma"];

/**
 * Issued documents by month, over one or more kinds. Drafts are not sales.
 *
 * KINDS, plural, and it took one. The offers chart asked for kind `"offer"` —
 * a kind this ERP does not have; the catalogue calls a devis `quotation` — so
 * the query matched nothing and screen 28 said *Aucune offre émise* to a
 * company that had issued them all year. A figure that is always zero is worse
 * than no figure: it is read as an answer.
 */
export async function issuedByMonth(kinds: string[], months = 12): Promise<MonthRow[]> {
  const rows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${document.issuedOn}::date), 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum((${document.totals}->>'totalIncl')::numeric), 0)::text`,
    })
    .from(document)
    .where(
      and(
        inArray(document.kind, kinds),
        isNotNull(document.number),
        // True by construction today — a discarded row can never have a number
        // — and stated anyway, so the two charts and the kind table are read
        // off the same rule rather than off an argument about what is possible.
        liveDocument,
        isNotNull(document.issuedOn),
        sql`${document.issuedOn}::date > current_date - make_interval(months => ${months})`,
      ),
    )
    .groupBy(sql`date_trunc('month', ${document.issuedOn}::date)`)
    .orderBy(desc(sql`date_trunc('month', ${document.issuedOn}::date)`));

  return rows;
}

export type KindRow = { kind: string; issued: number; drafts: number };

/**
 * What this company actually produces, by document kind.
 *
 * T9 — `liveDocument`, and it is the whole of the owner's first disagreement.
 * Invoices showed zero while this screen and Compliance both saw an invoice
 * draft, and all three were reading the same single row: a draft somebody had
 * discarded. Screen 17 filters the bin because it is the one money query that
 * can see a draft at all; this did not, so a document in the bin was still
 * counted as work in hand.
 *
 * Screen 17 was right. Making the numbers agree by showing binned drafts on
 * screen 17 would have been the wrong direction — the fix is that a discarded
 * document is counted nowhere, not that it is counted everywhere.
 */
export async function byKind(): Promise<KindRow[]> {
  return db
    .select({
      kind: document.kind,
      issued: sql<number>`count(*) filter (where ${document.number} is not null)::int`,
      drafts: sql<number>`count(*) filter (where ${document.status} = 'draft')::int`,
    })
    .from(document)
    .where(liveDocument)
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
    issuedByMonth(INVOICED_KINDS),
    /*
      AN OFFER IS A DEVIS OR A PROFORMA. Both, because both are sent to a
      client to win work and the company uses whichever the client asked for —
      a proforma for somebody who has to pay against it, a devis for a tender.

      A devis converted to a proforma for the same job counts twice, and the
      screen says what it counted rather than hiding that: two offers did leave
      the building. Picking one of the two kinds instead would show nothing at
      all for half the company's work.
    */
    issuedByMonth(OFFER_KINDS),
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
