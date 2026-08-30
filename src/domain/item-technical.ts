import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { deal } from "@/db/schema/deal";
import { item, itemCoverage, itemMedia } from "@/db/schema/item";
import { party } from "@/db/schema/party";

/**
 * Screen 77 — one item's technical file, across every enquiry.
 *
 * Screen 78 (`/deals/[id]/technical`) answers "is THIS enquiry's annexe
 * complete". This answers the other half: what do we hold on this item at all,
 * where did each piece come from, and which enquiries have needed it.
 *
 * The two are genuinely different questions and both were in the design. The
 * per-deal one shipped in phase 4; this one did not, so a datasheet gathered
 * for one tender was invisible to the next.
 *
 * Provenance is carried on every piece of media rather than inferred. "The
 * supplier sent it" and "we photographed it on a counter in Adrar" are
 * different kinds of evidence, and a client asking where a certificate came
 * from deserves the real answer.
 */

export type ItemMediaRow = {
  id: string;
  mediaKind: string;
  provenance: string;
  partyName: string | null;
  capturedAtPlace: string | null;
  dealId: string | null;
  supersededBy: string | null;
};

export type ItemTechnicalFile = {
  item: typeof item.$inferSelect;
  media: ItemMediaRow[];
  /** Enquiries that asked about this item, newest first. */
  usedOn: { dealId: string; ref: string; subject: string; requirement: string; status: string }[];
  hasDatasheet: boolean;
};

export async function itemTechnicalFile(itemId: string): Promise<ItemTechnicalFile | null> {
  const [found] = await db.select().from(item).where(eq(item.id, itemId)).limit(1);
  if (!found) return null;

  const media = await db
    .select({
      id: itemMedia.id,
      mediaKind: itemMedia.mediaKind,
      provenance: itemMedia.provenance,
      partyName: sql<
        string | null
      >`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      capturedAtPlace: itemMedia.capturedAtPlace,
      dealId: itemMedia.dealId,
      supersededBy: sql<string | null>`null`,
    })
    .from(itemMedia)
    .leftJoin(party, eq(party.id, itemMedia.partyId))
    .where(eq(itemMedia.itemId, itemId));

  const usedOn = await db
    .select({
      dealId: deal.id,
      ref: deal.ref,
      subject: deal.subject,
      requirement: itemCoverage.requirement,
      status: itemCoverage.status,
    })
    .from(itemCoverage)
    .innerJoin(deal, eq(deal.id, itemCoverage.dealId))
    .where(eq(itemCoverage.itemId, itemId))
    .orderBy(desc(deal.createdAt))
    .limit(50);

  return {
    item: found,
    media,
    usedOn,
    hasDatasheet: media.some((row) => row.mediaKind === "datasheet"),
  };
}
