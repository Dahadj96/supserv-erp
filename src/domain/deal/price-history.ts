import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { priceQuote } from "@/db/schema/deal";
import { document, documentLine } from "@/db/schema/document";
import { party } from "@/db/schema/party";

/**
 * "What did this cost last time, and what did we sell it at?"
 *
 * The question a person asks before pricing a line, and until now the
 * answer lived in their memory and in last year's proformas. The catalogue
 * (`item`) is the right key for it and is empty — nobody has matched a line
 * to an item yet — so the key is the WORDING: an enquiry from the same
 * client repeats its own bordereau word for word, and a supplier's price
 * was captured with the wording it was a price for (`price_quote.designation`).
 *
 * Matching is by significant words, all of them: "galet convoyeur 89 315"
 * finds "Galet de convoyeur Ø89 × 315 mm" and not "Galet de guidage". Wide
 * enough to find last June, narrow enough not to average two different
 * things. Nothing is stored; this is a read over documents that already
 * exist, and the day items are matched it becomes a join instead.
 */

/** Kinds on which a unit price is OURS, offered to a client. */
const SOLD_KINDS = ["quotation", "proforma", "offer", "client_order", "invoice", "situation"];

const STOP = new Set([
  "de",
  "du",
  "des",
  "la",
  "le",
  "les",
  "un",
  "une",
  "et",
  "en",
  "au",
  "aux",
  "pour",
  "avec",
  "sur",
  "par",
  "the",
  "of",
  "and",
  "for",
  "with",
  "mm",
  "ml",
  "kg",
  "pcs",
]);

/** The words that carry meaning, lower-cased and unaccented. */
export function significantWords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .filter((w) => w.length >= 2 && !STOP.has(w) && !/^\d$/.test(w)),
    ),
  );
}

export type SoldBefore = {
  documentId: string;
  number: string | null;
  kind: string;
  issuedOn: string | null;
  client: string;
  /** The same client as the enquiry being priced now. */
  sameClient: boolean;
  qty: string;
  unitPrice: string;
  unitCost: string | null;
  currency: string;
};

export type BoughtBefore = {
  quoteId: string;
  supplier: string | null;
  price: string;
  currency: string;
  isExclVat: boolean;
  isVerbal: boolean;
  source: string;
  capturedAt: Date;
  validUntil: string | null;
};

export type PriceHistory = { sold: SoldBefore[]; bought: BoughtBefore[] };

function wordFilter(
  column: typeof documentLine.designation | typeof priceQuote.designation,
  words: string[],
) {
  // `unaccent` has been on the database since the search indexes of phase 1,
  // so "cable" finds "Câble" and "Ø89" — whose Ø is not a letter — finds
  // "89" the same way `significantWords` read it.
  return and(...words.map((w) => sql`unaccent(${column}) ilike ${`%${w}%`}`));
}

/**
 * Every issued line of ours with the same wording, newest first, and every
 * supplier price captured for it.
 */
export async function priceHistory(
  designation: string,
  opts: { partyId?: string | null; limit?: number; excludeDocumentId?: string | null } = {},
): Promise<PriceHistory> {
  const words = significantWords(designation);
  if (words.length === 0) return { sold: [], bought: [] };
  const limit = opts.limit ?? 5;

  const sold = await db
    .select({
      documentId: document.id,
      number: document.number,
      kind: document.kind,
      issuedOn: document.issuedOn,
      partyId: document.partyId,
      client: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      qty: documentLine.qty,
      unitPrice: documentLine.unitPrice,
      unitCost: documentLine.unitCost,
      currency: document.currency,
    })
    .from(documentLine)
    .innerJoin(document, eq(document.id, documentLine.documentId))
    .leftJoin(party, eq(party.id, document.partyId))
    .where(
      and(
        eq(document.status, "issued"),
        inArray(document.kind, SOLD_KINDS),
        isNotNull(documentLine.unitPrice),
        opts.excludeDocumentId ? ne(document.id, opts.excludeDocumentId) : undefined,
        wordFilter(documentLine.designation, words),
      ),
    )
    .orderBy(desc(document.issuedOn), desc(document.createdAt))
    .limit(limit);

  const bought = await db
    .select({
      quoteId: priceQuote.id,
      supplier: sql<
        string | null
      >`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      price: priceQuote.price,
      currency: priceQuote.currency,
      isExclVat: priceQuote.isExclVat,
      isVerbal: priceQuote.isVerbal,
      source: priceQuote.source,
      capturedAt: priceQuote.capturedAt,
      validUntil: priceQuote.validUntil,
    })
    .from(priceQuote)
    .leftJoin(party, eq(party.id, priceQuote.partyId))
    .where(and(isNotNull(priceQuote.designation), wordFilter(priceQuote.designation, words)))
    .orderBy(desc(priceQuote.capturedAt))
    .limit(limit);

  return {
    sold: sold.map((row) => ({
      documentId: row.documentId,
      number: row.number,
      kind: row.kind,
      issuedOn: row.issuedOn,
      client: row.client ?? "—",
      sameClient: Boolean(opts.partyId) && row.partyId === opts.partyId,
      qty: row.qty ?? "0",
      unitPrice: row.unitPrice as string,
      unitCost: row.unitCost,
      currency: row.currency,
    })),
    bought,
  };
}
