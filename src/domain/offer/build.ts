import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine, priceQuote } from "@/db/schema/deal";
import { document, documentLine } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import { sourcingLine, sourcingRequest, sourcingResponse } from "@/db/schema/sourcing";
import { recomputeTotals } from "@/documents/totals";
import { priceHistory } from "@/domain/deal/price-history";
import { priceFromMargin } from "./margin";

/**
 * Screens 11 and 12 — turning an enquiry into an offer.
 *
 * This is the seam the whole phase was built towards: "an RFQ with items pasted
 * from an email body reaches a sent offer, and every price says where it came
 * from."
 *
 * The last clause is the work. Each offer line carries `unitCost`, `costSource`
 * and `costQuoteId`, so six weeks later the question "why did we quote 44 900
 * for that valve" has an answer that does not depend on anybody's memory or on
 * a supplier quote that has since been superseded.
 *
 * It does NOT issue anything. The offer is created as a draft with no number —
 * LAW 5 allocates at issue, and screen 12's Numbering card says so in as many
 * words: "Reserved — No, assigned on send."
 */

export class BuildRefused extends Error {
  constructor(readonly reason: "noSuchDeal" | "closed" | "noLines" | "noVatRate") {
    super(reason);
  }
}

/** Where a cost came from, in the order we prefer to take it. */
export const COST_SOURCES = [
  "supplier_quote",
  "internal_costing",
  "previous_offer",
  "manual",
] as const;
export type CostSource = (typeof COST_SOURCES)[number];

type ChosenCost = {
  unitCost: string;
  costSource: CostSource;
  costQuoteId: string | null;
  supplierName: string | null;
};

/**
 * The cost to carry onto the offer for one enquiry line.
 *
 * A sourcing answer beats a loose price quote, and the reason is not that it is
 * newer. A sourcing answer was given in reply to THIS enquiry, with these
 * quantities and this delivery date attached; a catalogue price was a number
 * somebody wrote down at a counter in June. Both are real, and when the
 * specific one exists it is the one that was actually offered to us.
 */
export function chooseCost(opts: {
  sourced: { unitPrice: string; supplierName: string }[];
  quoted: { id: string; price: string; supplierName: string | null; isVerbal: boolean }[];
  /**
   * What the same wording cost us on an offer already issued, newest first.
   * Third choice, after anything gathered for THIS enquiry: a cost from June
   * is a cost from June, and screen 12 says "previous offer" beside it so
   * the person knows to look again before signing.
   */
  previous?: { unitCost: string | null; number: string | null }[];
}): ChosenCost | null {
  const cheapestSourced = opts.sourced.reduce<{ unitPrice: string; supplierName: string } | null>(
    (best, row) => (!best || Number(row.unitPrice) < Number(best.unitPrice) ? row : best),
    null,
  );
  if (cheapestSourced) {
    return {
      unitCost: cheapestSourced.unitPrice,
      costSource: "supplier_quote",
      costQuoteId: null,
      supplierName: cheapestSourced.supplierName,
    };
  }

  const cheapestQuote = opts.quoted.reduce<(typeof opts.quoted)[number] | null>(
    (best, row) => (!best || Number(row.price) < Number(best.price) ? row : best),
    null,
  );
  if (cheapestQuote) {
    return {
      unitCost: cheapestQuote.price,
      costSource: "supplier_quote",
      costQuoteId: cheapestQuote.id,
      supplierName: cheapestQuote.supplierName,
    };
  }

  // The newest previous offer that carried a cost — not the cheapest: what
  // it cost last time is the fact, and the cheapest of three old figures is
  // a number nobody was ever quoted.
  const last = (opts.previous ?? []).find((row) => row.unitCost && Number(row.unitCost) > 0);
  if (last?.unitCost) {
    return {
      unitCost: last.unitCost,
      costSource: "previous_offer",
      costQuoteId: null,
      supplierName: last.number,
    };
  }

  // No cost anywhere. The line still goes on the offer — it is what the client
  // asked for — with no cost and no price, and screen 12's checklist counts it.
  return null;
}

/**
 * Build a draft offer from an enquiry.
 *
 * `defaultMarginPct` sets a starting price on every line that has a cost. It is
 * a starting point, not a decision: screen 12 is where a person walks down the
 * column and changes the ones that matter. A line with no cost gets no price,
 * because a price invented from nothing is worse than a blank a person will
 * notice.
 */
export async function buildOffer(opts: {
  dealId: string;
  kind?: string;
  defaultMarginPct?: string;
  vatRate?: string;
  actorId: string;
}): Promise<string> {
  const [row] = await db
    .select({
      id: deal.id,
      partyId: deal.partyId,
      currency: deal.currency,
      subject: deal.subject,
      lostAt: deal.lostAt,
      docLocale: party.docLocale,
    })
    .from(deal)
    .innerJoin(party, eq(party.id, deal.partyId))
    .where(and(eq(deal.id, opts.dealId), isNull(deal.deletedAt)))
    .limit(1);
  if (!row) throw new BuildRefused("noSuchDeal");
  if (row.lostAt) throw new BuildRefused("closed");

  const lines = await db
    .select()
    .from(dealLine)
    .where(eq(dealLine.dealId, opts.dealId))
    .orderBy(dealLine.position);
  if (lines.length === 0) throw new BuildRefused("noLines");

  // Every supplier answer on every SENT request for this enquiry.
  const sourced = await db
    .select({
      dealLineId: sourcingLine.dealLineId,
      unitPrice: sourcingLine.unitPrice,
      legalName: party.legalName,
      tradeName: party.tradeName,
    })
    .from(sourcingLine)
    .innerJoin(sourcingResponse, eq(sourcingResponse.id, sourcingLine.responseId))
    .innerJoin(sourcingRequest, eq(sourcingRequest.id, sourcingResponse.requestId))
    .innerJoin(party, eq(party.id, sourcingResponse.partyId))
    .where(
      and(
        eq(sourcingRequest.dealId, opts.dealId),
        eq(sourcingResponse.status, "quoted"),
        sql`${sourcingRequest.sentAt} is not null`,
        sql`${sourcingLine.unitPrice} is not null`,
      ),
    );

  const quotes = await db
    .select({
      id: priceQuote.id,
      dealLineId: priceQuote.dealLineId,
      price: priceQuote.price,
      isVerbal: priceQuote.isVerbal,
      legalName: party.legalName,
      tradeName: party.tradeName,
    })
    .from(priceQuote)
    .leftJoin(party, eq(party.id, priceQuote.partyId))
    .where(eq(priceQuote.dealId, opts.dealId));

  const margin = opts.defaultMarginPct ?? "20";
  const vatRate = opts.vatRate ?? "19";

  // What the same wording cost on an earlier offer — looked up only for the
  // lines nothing was gathered for, because a price captured for THIS
  // enquiry always wins and the lookup is a word search over every document.
  const previousByLine = new Map<string, { unitCost: string | null; number: string | null }[]>();
  for (const line of lines) {
    const hasOwn =
      sourced.some((s) => s.dealLineId === line.id) || quotes.some((q) => q.dealLineId === line.id);
    if (hasOwn || !line.designation) continue;
    const history = await priceHistory(line.designation, { partyId: row.partyId, limit: 3 });
    previousByLine.set(
      line.id,
      history.sold.map((s) => ({ unitCost: s.unitCost, number: s.number })),
    );
  }

  const documentId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(document)
      .values({
        kind: opts.kind ?? "quotation",
        partyId: row.partyId,
        dealId: row.id,
        // LAW 4 — the document's language follows the counterparty, not the
        // person building it.
        locale: row.docLocale,
        currency: row.currency,
        // No number. LAW 5 allocates at issue, and screen 12 says so:
        // "Reserved — No, assigned on send."
        number: null,
        status: "draft",
        totals: {},
      })
      .returning({ id: document.id });

    const documentId = created?.id as string;

    let costed = 0;
    const rows = lines.map((line, index) => {
      const cost = chooseCost({
        sourced: sourced
          .filter((s) => s.dealLineId === line.id && s.unitPrice !== null)
          .map((s) => ({
            unitPrice: s.unitPrice as string,
            supplierName: s.tradeName?.trim() || s.legalName,
          })),
        quoted: quotes
          .filter((q) => q.dealLineId === line.id)
          .map((q) => ({
            id: q.id,
            price: q.price,
            supplierName: q.tradeName?.trim() || q.legalName,
            isVerbal: q.isVerbal,
          })),
        previous: previousByLine.get(line.id) ?? [],
      });
      if (cost) costed += 1;

      return {
        documentId,
        position: index + 1,
        lineKind: "item",
        itemId: line.itemId,
        // Which enquiry line this answers. Screen 42 reads `our price` back
        // through it; position cannot, because the client numbers their own
        // bordereau and an erratum leaves gaps in it.
        dealLineId: line.id,
        // The client's own reference travels onto the offer unchanged. It is
        // how they will check our document against their consultation.
        reference: line.reference,
        designation: line.designation,
        unit: line.unit,
        qty: line.qty,
        unitCost: cost?.unitCost ?? null,
        costSource: cost?.costSource ?? null,
        costQuoteId: cost?.costQuoteId ?? null,
        // No cost, no price. A price invented from nothing is worse than a
        // blank somebody will notice.
        unitPrice: cost ? priceFromMargin(cost.unitCost, margin) : null,
        vatRate,
      };
    });

    await tx.insert(documentLine).values(rows);

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "document",
      entityId: documentId,
      action: "create",
      after: {
        kind: opts.kind ?? "quotation",
        fromDeal: row.id,
        lines: rows.length,
        // How many lines arrived with a real cost behind them. The margin on
        // this offer is only as honest as this number.
        linesWithCost: costed,
        defaultMarginPct: margin,
        // Named so a later reader knows no number was taken.
        numberReserved: false,
      },
      sourceScreen: "12",
    });

    return documentId;
  });

  // The lines carry prices from the moment they are built; the document has
  // to carry the sum of them from the same moment, or the first preview reads
  // "Total HT 0,00" under a priced table.
  await recomputeTotals(documentId);

  return documentId;
}
