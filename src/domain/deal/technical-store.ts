import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine, priceQuote } from "@/db/schema/deal";
import { item, itemCoverage, itemMedia } from "@/db/schema/item";
import { party } from "@/db/schema/party";
import { sourcingLine, sourcingRequest, sourcingResponse } from "@/db/schema/sourcing";
import {
  annexeVerdict,
  coverageOf,
  isRequirement,
  type MediaKind,
  type Provenance,
  type Requirement,
  stateOf,
  type TechnicalItem,
} from "./technical";

/**
 * Screen 78 — the database half.
 *
 * The join that matters: a deal line points at an ITEM (when somebody matched
 * it), and the files hang off the item. That is the whole economics of this
 * screen — a datasheet found once serves every future enquiry, and the second
 * time TouatGaz asks for the same valve the technical file is already complete.
 *
 * The one exception is a picture the CLIENT sent, which is locked to the deal
 * it arrived on because it records what THAT client asked for.
 */

export class TechnicalRefused extends Error {
  constructor(readonly reason: "noSuchDeal" | "noSuchLine" | "notMatched" | "reasonRequired") {
    super(reason);
  }
}

export async function technicalFile(dealId: string) {
  const [row] = await db
    .select({
      id: deal.id,
      ref: deal.ref,
      requirement: deal.datasheetRequirement,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      docLocale: party.docLocale,
    })
    .from(deal)
    .innerJoin(party, eq(party.id, deal.partyId))
    .where(and(eq(deal.id, dealId), isNull(deal.deletedAt)))
    .limit(1);
  if (!row) return null;

  const lines = await db
    .select({
      id: dealLine.id,
      position: dealLine.position,
      designation: dealLine.designation,
      itemId: dealLine.itemId,
      isGeneric: item.isGeneric,
    })
    .from(dealLine)
    .leftJoin(item, eq(item.id, dealLine.itemId))
    .where(eq(dealLine.dealId, dealId))
    .orderBy(dealLine.position);

  const itemIds = lines.map((l) => l.itemId).filter((id): id is string => Boolean(id));

  /**
   * Item-wide files, plus this deal's own client images. A client image from
   * ANOTHER deal is deliberately excluded — it belongs to that negotiation.
   */
  const media = itemIds.length
    ? await db
        .select({
          itemId: itemMedia.itemId,
          kind: itemMedia.mediaKind,
          provenance: itemMedia.provenance,
          dealId: itemMedia.dealId,
        })
        .from(itemMedia)
        .where(
          and(
            inArray(itemMedia.itemId, itemIds),
            sql`${itemMedia.dealId} is null or ${itemMedia.dealId} = ${dealId}`,
          ),
        )
    : [];

  const coverageRows = await db.select().from(itemCoverage).where(eq(itemCoverage.dealId, dealId));

  /**
   * Whether ANY supplier has been found for the line — from a sourcing answer
   * or from a price somebody recorded. It separates "we have a supplier and no
   * datasheet" (chase them) from "we have nobody" (find somebody first), which
   * is two different jobs and the reason those are two different states.
   */
  const sourcedLines = await db
    .selectDistinct({ dealLineId: sourcingLine.dealLineId })
    .from(sourcingLine)
    .innerJoin(sourcingResponse, eq(sourcingResponse.id, sourcingLine.responseId))
    .innerJoin(sourcingRequest, eq(sourcingRequest.id, sourcingResponse.requestId))
    .where(and(eq(sourcingRequest.dealId, dealId), eq(sourcingResponse.status, "quoted")));

  const quotedLines = await db
    .selectDistinct({ dealLineId: priceQuote.dealLineId })
    .from(priceQuote)
    .where(eq(priceQuote.dealId, dealId));

  const withSupplier = new Set(
    [...sourcedLines, ...quotedLines].map((r) => r.dealLineId).filter(Boolean),
  );

  const items: TechnicalItem[] = lines.map((line) => {
    const coverage = coverageRows.find((c) => c.itemId === line.itemId);
    return {
      dealLineId: line.id,
      itemId: line.itemId,
      designation: line.designation,
      isGeneric: line.isGeneric ?? false,
      notApplicableReason:
        coverage?.status === "not_applicable" ? (coverage.notApplicableReason ?? null) : null,
      media: media
        .filter((m) => m.itemId === line.itemId)
        .map((m) => ({ kind: m.kind as MediaKind, provenance: m.provenance as Provenance })),
      hasSupplier: withSupplier.has(line.id),
    };
  });

  const requirement: Requirement = isRequirement(row.requirement) ? row.requirement : "not_stated";

  return {
    deal: row,
    requirement,
    items,
    // Both computed on read. Nothing here is stored, so nothing can be stale —
    // a datasheet uploaded a minute ago changes this screen and every offer
    // that depends on it, without a job running anywhere.
    coverage: coverageOf(items),
    verdict: annexeVerdict(items, requirement),
    states: new Map(items.map((i) => [i.dealLineId, stateOf(i)] as const)),
    /** Line order, so the table and the gap list agree. */
    order: new Map(lines.map((l) => [l.id, l.position] as const)),
  };
}

/** Screen 78's toggle. One answer for the whole deal. */
export async function setRequirement(opts: {
  dealId: string;
  requirement: string;
  actorId: string;
}): Promise<void> {
  if (!isRequirement(opts.requirement)) throw new TechnicalRefused("noSuchDeal");

  const [before] = await db
    .select({ was: deal.datasheetRequirement })
    .from(deal)
    .where(and(eq(deal.id, opts.dealId), isNull(deal.deletedAt)))
    .limit(1);
  if (!before) throw new TechnicalRefused("noSuchDeal");

  await db
    .update(deal)
    .set({ datasheetRequirement: opts.requirement })
    .where(eq(deal.id, opts.dealId));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "deal",
    entityId: opts.dealId,
    action: "update",
    before: { datasheetRequirement: before.was },
    after: { datasheetRequirement: opts.requirement },
    sourceScreen: "78",
  });
}

/**
 * "Not applicable — and here is why."
 *
 * The reason is REQUIRED, in the domain and in the database (migration 0020).
 * Screen 78: "Marked once, with a reason, and it counts as complete." Without
 * the reason it is indistinguishable from somebody clicking to make a red row
 * go away, and six months later nobody can tell which of the two it was.
 */
export async function markNotApplicable(opts: {
  dealId: string;
  dealLineId: string;
  reason: string;
  actorId: string;
}): Promise<void> {
  const reason = opts.reason.trim();
  if (!reason) throw new TechnicalRefused("reasonRequired");

  const [line] = await db
    .select({ id: dealLine.id, itemId: dealLine.itemId })
    .from(dealLine)
    .where(and(eq(dealLine.id, opts.dealLineId), eq(dealLine.dealId, opts.dealId)))
    .limit(1);
  if (!line) throw new TechnicalRefused("noSuchLine");
  // Coverage hangs off the ITEM, so a line nobody has matched to the catalogue
  // has nowhere to record this. Saying so is more use than failing silently.
  if (!line.itemId) throw new TechnicalRefused("notMatched");

  await db
    .insert(itemCoverage)
    .values({
      dealId: opts.dealId,
      itemId: line.itemId,
      requirement: "not_stated",
      status: "not_applicable",
      notApplicableReason: reason,
    })
    .onConflictDoUpdate({
      target: [itemCoverage.dealId, itemCoverage.itemId],
      set: { status: "not_applicable", notApplicableReason: reason },
    });

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "item_coverage",
    entityId: line.itemId,
    action: "update",
    after: { dealId: opts.dealId, status: "not_applicable", reason },
    sourceScreen: "78",
  });
}

/** Undo. The mark was wrong, or a datasheet turned up after all. */
export async function clearNotApplicable(opts: {
  dealId: string;
  itemId: string;
  actorId: string;
}): Promise<void> {
  await db
    .delete(itemCoverage)
    .where(and(eq(itemCoverage.dealId, opts.dealId), eq(itemCoverage.itemId, opts.itemId)));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "item_coverage",
    entityId: opts.itemId,
    action: "update",
    after: { dealId: opts.dealId, status: null },
    sourceScreen: "78",
  });
}
