import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine, priceQuote } from "@/db/schema/deal";
import { party, partyRole } from "@/db/schema/party";
import { isPriceSource, type PriceSource, type Quote } from "./prices";

/**
 * Screen 74 — the database half.
 *
 * `prices.ts` stays pure so the browser can import the types and the firmness
 * rules without dragging `postgres` into the bundle. That split is not
 * tidiness; see the note at the top of `src/capture/reading.ts` for the
 * afternoon it cost to learn.
 */

export class PriceRefused extends Error {
  constructor(
    readonly reason:
      | "noSuchDeal"
      | "closed"
      | "unknownSource"
      | "noPrice"
      | "noSubject"
      | "verbalCannotHaveEvidence"
      | "supplierRequired",
  ) {
    super(reason);
  }
}

/** Every price gathered for one enquiry, newest first. */
export async function quotesFor(dealId: string): Promise<Quote[]> {
  const rows = await db
    .select({
      id: priceQuote.id,
      dealLineId: priceQuote.dealLineId,
      itemId: priceQuote.itemId,
      designation: priceQuote.designation,
      source: priceQuote.source,
      price: priceQuote.price,
      currency: priceQuote.currency,
      isVerbal: priceQuote.isVerbal,
      capturedAt: priceQuote.capturedAt,
      capturedPlace: priceQuote.capturedPlace,
      validUntil: priceQuote.validUntil,
      supplierLegal: party.legalName,
      supplierTrade: party.tradeName,
    })
    .from(priceQuote)
    .leftJoin(party, eq(party.id, priceQuote.partyId))
    .where(eq(priceQuote.dealId, dealId))
    .orderBy(desc(priceQuote.capturedAt));

  return rows.map((row) => ({
    id: row.id,
    dealLineId: row.dealLineId,
    itemId: row.itemId,
    designation: row.designation,
    source: (isPriceSource(row.source) ? row.source : "supplier_email") as PriceSource,
    supplierName: row.supplierTrade?.trim() || row.supplierLegal || null,
    price: row.price,
    currency: row.currency,
    isVerbal: row.isVerbal,
    capturedAt: row.capturedAt,
    capturedPlace: row.capturedPlace,
    // `date` comes back as a string; the pure module compares Dates.
    validUntil: row.validUntil ? new Date(`${row.validUntil}T00:00:00Z`) : null,
  }));
}

/**
 * "Ets Chergui is not in Companies — it will be created as a supplier."
 *
 * The yellow note on screen 74, and the behaviour behind it. A shop you walked
 * into is a supplier whether or not anybody has typed it in, and refusing the
 * price until somebody fills in a company form is how the price ends up on a
 * scrap of paper instead.
 *
 * So the company is created — with the supplier role, from this screen, with an
 * audit entry saying where it came from. It has a name and nothing else, which
 * is honest: nobody asked for its NIF at the counter.
 */
export async function supplierByName(
  name: string,
  actorId: string,
): Promise<{ id: string; created: boolean }> {
  const trimmed = name.trim();
  if (!trimmed) throw new PriceRefused("supplierRequired");

  const [existing] = await db
    .select({ id: party.id })
    .from(party)
    .where(
      and(
        isNull(party.deletedAt),
        or(
          sql`lower(${party.legalName}) = ${trimmed.toLowerCase()}`,
          sql`lower(coalesce(${party.tradeName}, '')) = ${trimmed.toLowerCase()}`,
        ),
      ),
    )
    .limit(1);
  if (existing) return { id: existing.id, created: false };

  return db.transaction(async (tx) => {
    const [row] = await tx.execute<{ next: number }>(sql`
      select coalesce(max(substring(code from 4)::int), 0) + 1 as next
      from party where code like 'SU-%' and code ~ '^SU-[0-9]+$'
    `);
    const code = `SU-${String(row?.next ?? 1).padStart(4, "0")}`;

    const [created] = await tx
      .insert(party)
      .values({ code, legalName: trimmed })
      .returning({ id: party.id });

    const id = created?.id as string;
    await tx.insert(partyRole).values({ partyId: id, role: "supplier" });
    await tx.insert(auditEntry).values({
      actorId,
      actorKind: "user",
      entity: "party",
      entityId: id,
      action: "create",
      after: { code, legalName: trimmed, role: "supplier", becauseOf: "priceCapture" },
      sourceScreen: "74",
    });

    return { id, created: true };
  });
}

export type NewQuote = {
  dealId: string;
  dealLineId: string | null;
  source: string;
  supplierName: string | null;
  price: string;
  currency: string;
  isExclVat: boolean;
  isVerbal: boolean;
  validUntil: string | null;
  capturedPlace: string | null;
  capturedFrom: string | null;
  actorId: string;
};

/**
 * Record a price.
 *
 * The refusals are all about the label meaning something. A "verbal" price with
 * a document attached is not verbal, and if the word can mean both then the
 * "unconfirmed" mark on the offer means nothing — which is the same reasoning
 * as the check constraint in migration 0015. Belt and braces on purpose: the
 * constraint stops bad rows, this stops a five-hundred reaching a person who
 * only wanted to type in a price.
 */
export async function addQuote(input: NewQuote): Promise<string> {
  if (!isPriceSource(input.source)) throw new PriceRefused("unknownSource");

  const price = input.price.trim().replace(/[\s ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(price) || Number(price) <= 0) throw new PriceRefused("noPrice");
  if (!input.dealLineId) throw new PriceRefused("noSubject");

  const [row] = await db
    .select({ lostAt: deal.lostAt })
    .from(deal)
    .where(and(eq(deal.id, input.dealId), isNull(deal.deletedAt)))
    .limit(1);
  if (!row) throw new PriceRefused("noSuchDeal");
  if (row.lostAt) throw new PriceRefused("closed");

  const [line] = await db
    .select({ id: dealLine.id, itemId: dealLine.itemId, designation: dealLine.designation })
    .from(dealLine)
    .where(and(eq(dealLine.id, input.dealLineId), eq(dealLine.dealId, input.dealId)))
    .limit(1);
  if (!line) throw new PriceRefused("noSubject");

  // Our own costing has no supplier. Everything else does — even if it is a
  // shop nobody had written down until this moment.
  let partyId: string | null = null;
  if (input.source !== "internal_costing") {
    const supplier = await supplierByName(input.supplierName ?? "", input.actorId);
    partyId = supplier.id;
  }

  const isVerbal = input.source === "internal_costing" ? false : input.isVerbal;

  const [created] = await db
    .insert(priceQuote)
    .values({
      itemId: line.itemId,
      dealLineId: line.id,
      dealId: input.dealId,
      // Copied now, while the line exists. It is what the row will have left
      // to say for itself once somebody corrects the paste and the line is
      // replaced — see the column's note in the schema.
      designation: line.designation,
      source: input.source,
      partyId,
      price,
      currency: input.currency || "DZD",
      isExclVat: input.isExclVat,
      isVerbal,
      evidenceFileId: null,
      capturedBy: input.actorId,
      capturedPlace: input.capturedPlace?.trim() || null,
      capturedFrom: input.capturedFrom?.trim() || null,
      validUntil: input.validUntil || null,
    })
    .returning({ id: priceQuote.id });

  const id = created?.id as string;
  await db.insert(auditEntry).values({
    actorId: input.actorId,
    actorKind: "user",
    entity: "price_quote",
    entityId: id,
    action: "create",
    after: {
      dealId: input.dealId,
      dealLineId: line.id,
      source: input.source,
      price,
      currency: input.currency || "DZD",
      // Recorded explicitly rather than inferred later. Whether a price was
      // somebody's word is the fact the offer's "unconfirmed" mark rests on.
      isVerbal,
      validUntil: input.validUntil || null,
    },
    sourceScreen: "74",
  });

  return id;
}

export type CounterPrice = {
  /** What it was a price FOR, in words. The only mandatory subject. */
  designation: string;
  /** The shop. Created as a supplier with a name and nothing else if new. */
  supplierName: string;
  price: string;
  currency?: string;
  isExclVat: boolean;
  /** Said, not written. True at a counter unless a paper came back with you. */
  isVerbal: boolean;
  /** "Ets Chergui, Adrar" — where you were standing. */
  capturedPlace?: string | null;
  /** Who said it, when the who is a person rather than a company. */
  capturedFrom?: string | null;
  validUntil?: string | null;
  actorId: string;
};

/**
 * Screen 74 — at the counter, writing down a price. The second of the four
 * phone jobs.
 *
 * This is `addQuote`'s case with the enquiry taken away, and taking it away is
 * the whole point: standing in a shop in Adrar there is usually no consultation
 * open, and the price is worth keeping anyway. The schema said so from the
 * start — `price_quote_has_a_subject` accepts a DESIGNATION as the subject, and
 * `deal_id` is nullable because "a price with no deal is a catalogue price and
 * serves every future enquiry".
 *
 * It serves them through `priceHistory`, which matches on the wording: a price
 * captured at a counter in September answers "what did this cost last time" on
 * an offer built in November, without anybody filing it anywhere.
 *
 * `isVerbal` defaults to true on the screen and is recorded either way, because
 * the offer's "unconfirmed" mark rests on it — LAW 2, on a phone.
 */
export async function capturePrice(input: CounterPrice): Promise<string> {
  const designation = input.designation.trim();
  if (!designation) throw new PriceRefused("noSubject");

  const price = input.price
    .trim()
    .replace(/[\s  ]/g, "")
    .replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(price) || Number(price) <= 0) throw new PriceRefused("noPrice");

  // At a counter there is always a shop. `supplierByName` finds it or writes it
  // down with a name and nothing else, which is honest: nobody asked for its
  // NIF at the counter.
  const supplier = await supplierByName(input.supplierName ?? "", input.actorId);

  const [created] = await db
    .insert(priceQuote)
    .values({
      // No item and no deal line: the wording is the subject, and it is what
      // the price-history search reads.
      itemId: null,
      dealLineId: null,
      dealId: null,
      designation,
      source: "shop_visit",
      partyId: supplier.id,
      price,
      currency: input.currency || "DZD",
      isExclVat: input.isExclVat,
      isVerbal: input.isVerbal,
      evidenceFileId: null,
      capturedBy: input.actorId,
      capturedPlace: input.capturedPlace?.trim() || null,
      capturedFrom: input.capturedFrom?.trim() || null,
      validUntil: input.validUntil || null,
    })
    .returning({ id: priceQuote.id });

  const id = created?.id as string;
  await db.insert(auditEntry).values({
    actorId: input.actorId,
    actorKind: "user",
    entity: "price_quote",
    entityId: id,
    action: "create",
    after: {
      designation,
      source: "shop_visit",
      supplier: supplier.id,
      supplierCreated: supplier.created,
      price,
      currency: input.currency || "DZD",
      isVerbal: input.isVerbal,
      isExclVat: input.isExclVat,
      catalogue: true,
    },
    sourceScreen: "74",
  });

  return id;
}

/** The last few counter prices, newest first — what screen 74 shows under the form. */
export async function recentCounterPrices(limit = 8) {
  return db
    .select({
      id: priceQuote.id,
      designation: priceQuote.designation,
      price: priceQuote.price,
      currency: priceQuote.currency,
      isExclVat: priceQuote.isExclVat,
      isVerbal: priceQuote.isVerbal,
      capturedAt: priceQuote.capturedAt,
      capturedPlace: priceQuote.capturedPlace,
      supplier: sql<string | null>`(
        select coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})
        from ${party} where ${party.id} = ${priceQuote.partyId}
      )`,
    })
    .from(priceQuote)
    .where(eq(priceQuote.source, "shop_visit"))
    .orderBy(desc(priceQuote.capturedAt))
    .limit(limit);
}
