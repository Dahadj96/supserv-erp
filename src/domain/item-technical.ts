import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine } from "@/db/schema/deal";
import { item, itemCoverage, itemMedia } from "@/db/schema/item";
import { party } from "@/db/schema/party";
import { fileId } from "@/domain/files";
import { storageFor } from "@/storage";

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
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
  /**
   * `item:9f0c…` — the id `/api/files/[id]` takes. The screen listed a
   * datasheet's provenance and gave no way to open it, because the row pointed
   * at a `file_id` in a table that does not exist.
   */
  fileId: string;
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

  const rows = await db
    .select({
      id: itemMedia.id,
      mediaKind: itemMedia.mediaKind,
      provenance: itemMedia.provenance,
      partyName: sql<
        string | null
      >`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      capturedAtPlace: itemMedia.capturedAtPlace,
      dealId: itemMedia.dealId,
      filename: itemMedia.filename,
      contentType: itemMedia.contentType,
      sizeBytes: itemMedia.sizeBytes,
    })
    .from(itemMedia)
    .leftJoin(party, eq(party.id, itemMedia.partyId))
    .where(eq(itemMedia.itemId, itemId))
    .orderBy(desc(itemMedia.createdAt));

  const media: ItemMediaRow[] = rows.map((r) => ({ ...r, fileId: fileId("item", r.id) }));

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

/** What a piece of media IS. The tender asks for a fiche technique by name. */
export const MEDIA_KINDS = ["datasheet", "certificate", "photo", "diagram", "manual"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * Where it came from, and it is never inferred.
 *
 * "The supplier sent it" and "we photographed it on a counter in Adrar" are
 * different kinds of evidence, and a client asking where a certificate came
 * from deserves the real answer.
 */
export const PROVENANCES = ["supplier", "manufacturer", "our_photo", "client"] as const;
export type Provenance = (typeof PROVENANCES)[number];

export class MediaRefused extends Error {
  constructor(readonly reason: "noSuchItem" | "badKind" | "badProvenance" | "empty" | "tooBig") {
    super(reason);
    this.name = "MediaRefused";
  }
}

/** Ten megabytes. A datasheet is a PDF; anything larger is a mistake. */
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

/**
 * Attach a datasheet, a certificate or a photograph to an item.
 *
 * The row owns its bytes — see the schema note. Nothing here decides what a
 * file IS from its name or its content type: the person says which of the five
 * kinds it is and where it came from, because "this PDF is the manufacturer's
 * certificate" is a claim, and a claim needs somebody behind it.
 */
export async function addItemMedia(opts: {
  itemId: string;
  filename: string;
  contentType: string | null;
  bytes: Buffer;
  mediaKind: string;
  provenance: string;
  partyId?: string | null;
  capturedAtPlace?: string | null;
  /** Set only for a picture the client sent: it belongs to that enquiry. */
  dealId?: string | null;
  actorId: string;
}): Promise<string> {
  const [found] = await db
    .select({ id: item.id, code: item.code })
    .from(item)
    .where(eq(item.id, opts.itemId))
    .limit(1);
  if (!found) throw new MediaRefused("noSuchItem");

  if (!MEDIA_KINDS.includes(opts.mediaKind as MediaKind)) throw new MediaRefused("badKind");
  if (!PROVENANCES.includes(opts.provenance as Provenance)) throw new MediaRefused("badProvenance");
  if (opts.bytes.length === 0) throw new MediaRefused("empty");
  if (opts.bytes.length > MAX_MEDIA_BYTES) throw new MediaRefused("tooBig");

  // The path is BUILT, never taken from the upload. `safeJoin` in the local
  // driver stops `..` escaping the root, and this stops it being tried.
  const safe = opts.filename.replace(/[^\w.-]+/g, "_").slice(0, 120) || "file";
  const path = `items/${found.code}/${Date.now()}-${safe}`;
  await storageFor("working").put({
    path,
    body: opts.bytes,
    mime: opts.contentType || "application/octet-stream",
  });

  const [created] = await db
    .insert(itemMedia)
    .values({
      itemId: opts.itemId,
      storagePath: path,
      filename: opts.filename.slice(0, 200),
      contentType: opts.contentType,
      sizeBytes: opts.bytes.length,
      mediaKind: opts.mediaKind,
      provenance: opts.provenance,
      partyId: opts.partyId || null,
      capturedAtPlace: opts.capturedAtPlace?.trim() || null,
      dealId: opts.dealId || null,
      addedBy: opts.actorId,
    })
    .returning({ id: itemMedia.id });

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "item_media",
    entityId: created?.id ?? "",
    action: "create",
    after: {
      itemId: opts.itemId,
      mediaKind: opts.mediaKind,
      provenance: opts.provenance,
      filename: opts.filename,
      bytes: opts.bytes.length,
    },
    sourceScreen: "77",
  });

  return created?.id as string;
}

/* ────────────────────────── the way in (V0) ─────────────────────────────
 *
 * `/items/[id]/technical` was a complete, working upload form that nothing in
 * the application linked to. No nav row, no list, no link from a deal line —
 * so the owner tested the ERP, found no way to attach a datasheet to an item,
 * and concluded the capability did not exist. It did; it had no door.
 *
 * This is the door: the catalogue itself, with the one fact that decides
 * whether the technical file needs attention — whether we hold a datasheet —
 * computed rather than stored, like everything else here.
 */

export type CatalogueRow = {
  id: string;
  code: string;
  designation: string;
  brand: string | null;
  model: string | null;
  unit: string | null;
  kind: string;
  isGeneric: boolean;
  mediaCount: number;
  hasDatasheet: boolean;
  /** How many enquiries have asked for this item. */
  usedOnCount: number;
};

/**
 * The catalogue, with what we hold on each item.
 *
 * A generic item — câble HP, boulonnerie, main-d'œuvre — is not missing a
 * datasheet, because no manufacturer publishes one. `isGeneric` is carried
 * through so the screen can say "complete" rather than nag for ever.
 */
export async function catalogue(opts?: {
  search?: string;
  limit?: number;
}): Promise<CatalogueRow[]> {
  const needle = opts?.search?.trim();

  const rows = await db
    .select({
      id: item.id,
      code: item.code,
      designation: item.designation,
      brand: item.brand,
      model: item.model,
      unit: item.unit,
      kind: item.kind,
      isGeneric: item.isGeneric,
      mediaCount: sql<number>`(select count(*)::int from ${itemMedia} where ${itemMedia.itemId} = ${item.id})`,
      datasheets: sql<number>`(select count(*)::int from ${itemMedia} where ${itemMedia.itemId} = ${item.id} and ${itemMedia.mediaKind} = 'datasheet')`,
      usedOnCount: sql<number>`(select count(*)::int from ${itemCoverage} where ${itemCoverage.itemId} = ${item.id})`,
    })
    .from(item)
    .where(
      needle
        ? sql`(${item.code} ilike ${`%${needle}%`} or ${item.designation} ilike ${`%${needle}%`} or coalesce(${item.brand}, '') ilike ${`%${needle}%`} or coalesce(${item.model}, '') ilike ${`%${needle}%`})`
        : undefined,
    )
    .orderBy(item.code)
    .limit(opts?.limit ?? 200);

  return rows.map(({ datasheets, ...r }) => ({ ...r, hasDatasheet: datasheets > 0 }));
}

/**
 * The enquiry an upload should be filed under, or null.
 *
 * The link from a deal's item table carries `?deal=`, and a query string is
 * not evidence. This is the check: the deal must exist AND one of its lines
 * must actually be matched to this item. `item_coverage` is the wrong test —
 * a line matched to the catalogue does not create a coverage row, so asking
 * that question would refuse the ordinary case.
 */
export async function dealBehindMedia(
  itemId: string,
  dealId: string,
): Promise<{ dealId: string; ref: string; subject: string } | null> {
  const [found] = await db
    .select({ dealId: deal.id, ref: deal.ref, subject: deal.subject })
    .from(deal)
    .innerJoin(dealLine, eq(dealLine.dealId, deal.id))
    .where(and(eq(deal.id, dealId), eq(dealLine.itemId, itemId)))
    .limit(1);
  return found ?? null;
}
