import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { deal, dealLine, priceQuote } from "@/db/schema/deal";
import { document, documentLine } from "@/db/schema/document";
import { party, partyRole } from "@/db/schema/party";
import { sourcingLine, sourcingRequest, sourcingResponse } from "@/db/schema/sourcing";
import {
  type LinePrices,
  type Outcome,
  outcomeOf,
  type PricePosition,
  type PriceRow,
  priceHistory,
  pricePosition,
  type QuoteFact,
  type ResponseFact,
  type Scorecard,
  scorecard,
} from "./supplier";

/**
 * Screen 23, against the database.
 *
 * Four queries and no writes. Everything the screen shows is derived from
 * sourcing requests, the lines suppliers priced, the costs that ended up on
 * offers, and whether those enquiries were won.
 */

export type ScorecardRequestRow = ResponseFact & {
  outcome: Outcome;
  turnaroundDays: number | null;
};

export type SupplierScorecard = {
  partyId: string;
  name: string;
  card: Scorecard;
  position: PricePosition;
  prices: PriceRow[];
  requests: ScorecardRequestRow[];
  /** Reply rates for every other supplier, for the comparison bars. */
  peers: { partyId: string; name: string; replyRate: number | null; asked: number }[];
};

const DAY = 86_400_000;

/** Every response this supplier has ever been sent, with its outcome. */
async function factsFor(partyId: string): Promise<ResponseFact[]> {
  const rows = await db
    .select({
      responseId: sourcingResponse.id,
      requestRef: sourcingRequest.ref,
      dealRef: deal.ref,
      dealId: deal.id,
      askedAt: sourcingRequest.sentAt,
      repliedAt: sourcingResponse.receivedAt,
      status: sourcingResponse.status,
      decision: deal.decision,
      lostAt: deal.lostAt,
      lines: sql<number>`(
        select count(*)::int from ${sourcingLine}
        where ${sourcingLine.responseId} = ${sourcingResponse.id}
      )`,
      /** Did any cost on an issued offer trace back to a quote of theirs? */
      used: sql<boolean>`exists (
        select 1 from ${documentLine}
        join ${document} d on d.id = ${documentLine.documentId}
        join ${priceQuote} q on q.id = ${documentLine.costQuoteId}
        where d.deal_id = ${deal.id} and q.party_id = ${sourcingResponse.partyId}
      )`,
      /** Won: a client order exists against the enquiry. */
      won: sql<boolean>`exists (
        select 1 from ${document} d
        where d.deal_id = ${deal.id} and d.kind = 'client_order'
      )`,
    })
    .from(sourcingResponse)
    .innerJoin(sourcingRequest, eq(sourcingRequest.id, sourcingResponse.requestId))
    .innerJoin(deal, eq(deal.id, sourcingRequest.dealId))
    .where(eq(sourcingResponse.partyId, partyId))
    .orderBy(desc(sourcingRequest.sentAt));

  return rows.map((row) => ({
    responseId: row.responseId,
    requestRef: row.requestRef,
    dealRef: row.dealRef,
    askedAt: row.askedAt,
    repliedAt: row.repliedAt,
    status: row.status,
    lines: row.lines,
    used: row.used,
    /**
     * Won, lost, or still open — and the three are different.
     *
     * `won` is a client order against the enquiry. `lost` is a fact somebody
     * recorded, because no document we hold says that a competitor won. An
     * enquiry with neither is undecided and belongs in neither half of the
     * win rate.
     */
    won: row.won ? true : row.lostAt ? false : null,
    weNoBid: row.decision === "no_bid",
  }));
}

export async function supplierScorecard(partyId: string): Promise<SupplierScorecard | null> {
  const [supplier] = await db
    .select({
      id: party.id,
      name: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
    })
    .from(party)
    .where(eq(party.id, partyId))
    .limit(1);
  if (!supplier) return null;

  const facts = await factsFor(partyId);

  const quotes: QuoteFact[] = (
    await db
      .select({
        reference: sourcingLine.theirReference,
        theirDesignation: sourcingLine.theirDesignation,
        ourDesignation: dealLine.designation,
        unitPrice: sourcingLine.unitPrice,
        quotedAt: sourcingResponse.receivedAt,
      })
      .from(sourcingLine)
      .innerJoin(sourcingResponse, eq(sourcingResponse.id, sourcingLine.responseId))
      .innerJoin(dealLine, eq(dealLine.id, sourcingLine.dealLineId))
      .where(
        and(
          eq(sourcingResponse.partyId, partyId),
          isNotNull(sourcingLine.unitPrice),
          isNotNull(sourcingResponse.receivedAt),
        ),
      )
  ).map((row) => ({
    reference: row.reference,
    // Their words first — screen 75's rule, and the history is about what THEY
    // quoted. Ours is the fallback so a line they never renamed still groups.
    designation: row.theirDesignation ?? row.ourDesignation,
    unitPrice: row.unitPrice as string,
    quotedAt: row.quotedAt as Date,
  }));

  return {
    partyId,
    name: supplier.name,
    card: scorecard(facts),
    position: await positionFor(partyId),
    prices: priceHistory(quotes),
    requests: facts.map((fact) => ({
      ...fact,
      outcome: outcomeOf(fact),
      turnaroundDays:
        fact.askedAt && fact.repliedAt
          ? Math.round(((fact.repliedAt.getTime() - fact.askedAt.getTime()) / DAY) * 10) / 10
          : null,
    })),
    peers: await peerReplyRates(partyId),
  };
}

/** Every line this supplier priced, with what everybody else said for it. */
async function positionFor(partyId: string): Promise<PricePosition> {
  const mine = await db
    .select({ dealLineId: sourcingLine.dealLineId })
    .from(sourcingLine)
    .innerJoin(sourcingResponse, eq(sourcingResponse.id, sourcingLine.responseId))
    .where(and(eq(sourcingResponse.partyId, partyId), isNotNull(sourcingLine.unitPrice)));

  const lineIds = [...new Set(mine.map((r) => r.dealLineId))];
  if (lineIds.length === 0) return { best: 0, compared: 0 };

  const all = await db
    .select({
      dealLineId: sourcingLine.dealLineId,
      partyId: sourcingResponse.partyId,
      unitPrice: sourcingLine.unitPrice,
    })
    .from(sourcingLine)
    .innerJoin(sourcingResponse, eq(sourcingResponse.id, sourcingLine.responseId))
    .where(and(inArray(sourcingLine.dealLineId, lineIds), isNotNull(sourcingLine.unitPrice)));

  const lines = new Map<string, LinePrices>();
  for (const row of all) {
    const held = lines.get(row.dealLineId) ?? { dealLineId: row.dealLineId, byParty: {} };
    held.byParty[row.partyId] = row.unitPrice as string;
    lines.set(row.dealLineId, held);
  }

  return pricePosition([...lines.values()], partyId);
}

/**
 * How the other suppliers answer, for the comparison bars.
 *
 * Every supplier, not only the ones in the same "category" the frame mentions —
 * there is no category column, and inventing one from the speciality free text
 * would group two companies because somebody typed the same word twice.
 */
async function peerReplyRates(partyId: string) {
  const suppliers = await db
    .select({
      id: party.id,
      name: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
    })
    .from(partyRole)
    .innerJoin(party, eq(party.id, partyRole.partyId))
    .where(eq(partyRole.role, "supplier"))
    .limit(30);

  const rates = await Promise.all(
    suppliers.map(async (supplier) => {
      const card = scorecard(await factsFor(supplier.id));
      return {
        partyId: supplier.id,
        name: supplier.name,
        replyRate: card.replyRate,
        asked: card.asked,
      };
    }),
  );

  return rates
    .filter((rate) => rate.asked > 0 || rate.partyId === partyId)
    .sort((a, b) => (b.replyRate ?? -1) - (a.replyRate ?? -1))
    .slice(0, 6);
}
