import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal } from "@/db/schema/deal";
import { document } from "@/db/schema/document";
import { party } from "@/db/schema/party";

/**
 * Screen 83 — three words that are not the same.
 *
 *   DISCARD  a draft nobody outside the company ever saw. Bin, 30 days.
 *   ARCHIVE  a real record that is finished. Out of lists and search by
 *            default, and every document pointing at it still works.
 *   CANCEL   an issued document. Never deleted — an avoir keeps the number.
 *
 * What may never be deleted, by anybody including the Gérant and including the
 * assistant: an issued document, a recorded payment, an audit entry, an email
 * sent or received, a number in a series, a tender dossier after deposit.
 *
 * So a company that has ever issued a document cannot be discarded. It can be
 * archived, which is the honest answer rather than a refusal with no route.
 */

export const BIN_DAYS = 30;

export class NotDiscardable extends Error {
  constructor(readonly issuedCount: number) {
    super("hasIssuedDocuments");
  }
}

async function issuedDocumentCount(partyId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(document)
    .where(and(eq(document.partyId, partyId), isNotNull(document.number)));
  return rows[0]?.n ?? 0;
}

/**
 * Soft delete only. `deleted_at` / `deleted_by` / `delete_reason`, a 30-day
 * bin, and an audit entry that outlives the record — after 30 days the row can
 * go but this entry stays, so in two years you can still find out that it
 * existed and why it went.
 */
export async function discardParty(opts: {
  id: string;
  reason: string;
  actorId: string;
  fromWhere?: string;
}) {
  const issued = await issuedDocumentCount(opts.id);
  if (issued > 0) throw new NotDiscardable(issued);

  const [before] = await db.select().from(party).where(eq(party.id, opts.id)).limit(1);
  if (!before) throw new Error("No such company");
  if (before.deletedAt) return;

  await db
    .update(party)
    .set({
      deletedAt: new Date(),
      // Was `null` while this column was `uuid` and the actor id is an opaque
      // Entra string. Migration 0017 widened it to text, so the row can once
      // again say who put it in the bin without a trip to the audit log.
      deletedBy: opts.actorId,
      deleteReason: opts.reason.trim() || null,
    })
    .where(eq(party.id, opts.id));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    entity: "party",
    entityId: opts.id,
    action: "discard",
    before: { code: before.code, legalName: before.legalName },
    reason: opts.reason.trim() || null,
    sourceScreen: opts.fromWhere ?? "22",
  });
}

export async function restoreParty(opts: { id: string; actorId: string }) {
  const [before] = await db.select().from(party).where(eq(party.id, opts.id)).limit(1);
  if (!before?.deletedAt) return;

  await db
    .update(party)
    .set({ deletedAt: null, deletedBy: null, deleteReason: null })
    .where(eq(party.id, opts.id));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    entity: "party",
    entityId: opts.id,
    action: "restore",
    after: { code: before.code, legalName: before.legalName },
    sourceScreen: "83",
  });
}

/** Archive is not delete: it leaves lists, and every document still resolves. */
export async function archiveParty(opts: { id: string; actorId: string }) {
  await db.update(party).set({ archivedAt: new Date() }).where(eq(party.id, opts.id));
  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    entity: "party",
    entityId: opts.id,
    action: "archive",
    sourceScreen: "22",
  });
}

/**
 * The same three words, applied to an enquiry.
 *
 * A deal is where the junk accumulates: every mistyped test row, every enquiry
 * that turned out to be somebody else's, every duplicate created while learning
 * the screen. `deal.deleted_at` has been migrated since 0015 and `listDeals`
 * has always filtered on it — nothing wrote it, so the list only ever grew.
 *
 * The guard is the same one companies have, for the same reason: an enquiry
 * that has issued a document is evidence. Migration 0016 set
 * `document.deal_id` to ON DELETE no action precisely so an enquiry going in
 * the bin can never take an issued invoice with it, and this refusal is that
 * rule said out loud rather than left to a foreign key.
 *
 * Marking a deal lost is not this. Lost is an outcome — it is a fact about the
 * world and it stays on the list with a red badge. Discard is "this row should
 * never have existed", and it belongs in the bin.
 */
async function issuedDocumentCountForDeal(dealId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(document)
    .where(and(eq(document.dealId, dealId), isNotNull(document.number)));
  return rows[0]?.n ?? 0;
}

export async function discardDeal(opts: {
  id: string;
  reason: string;
  actorId: string;
  fromWhere?: string;
}) {
  const issued = await issuedDocumentCountForDeal(opts.id);
  if (issued > 0) throw new NotDiscardable(issued);

  const [before] = await db.select().from(deal).where(eq(deal.id, opts.id)).limit(1);
  if (!before) throw new Error("No such enquiry");
  if (before.deletedAt) return;

  await db
    .update(deal)
    .set({
      deletedAt: new Date(),
      deletedBy: opts.actorId,
      deleteReason: opts.reason.trim() || null,
    })
    .where(eq(deal.id, opts.id));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    entity: "deal",
    entityId: opts.id,
    action: "discard",
    before: { ref: before.ref, subject: before.subject },
    reason: opts.reason.trim() || null,
    sourceScreen: opts.fromWhere ?? "06",
  });
}

export async function restoreDeal(opts: { id: string; actorId: string }) {
  const [before] = await db.select().from(deal).where(eq(deal.id, opts.id)).limit(1);
  if (!before?.deletedAt) return;

  await db
    .update(deal)
    .set({ deletedAt: null, deletedBy: null, deleteReason: null })
    .where(eq(deal.id, opts.id));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    entity: "deal",
    entityId: opts.id,
    action: "restore",
    after: { ref: before.ref, subject: before.subject },
    sourceScreen: "83",
  });
}

/**
 * The same three words, applied to a document — and the narrowest of the three.
 *
 * A company or an enquiry refuses the bin because of what hangs off it. A
 * document refuses because of what it IS. Once a number is allocated or the
 * row is locked, the paper has left the building: a client holds a copy, the
 * series has counted it, and LAW 5 says the only correction is another
 * document — an avoir that keeps its own number and leaves the first one
 * standing. There is no reason good enough, and no role high enough, to make
 * that row go quiet.
 *
 * Which leaves exactly one thing this is for: the draft nobody outside the
 * company ever saw. The wrong client, the duplicate, the one typed while
 * learning the screen. `number IS NULL AND locked_at IS NULL` — both, not
 * either. `number` alone would let a locked client order through, because a
 * client's bon de commande carries their reference and never takes one of
 * ours; `locked_at` alone would trust a lock nothing sets on a draft.
 */
export class DocumentIsIssued extends Error {
  constructor(
    readonly kind: string,
    readonly number: string | null,
  ) {
    super("documentIsIssued");
  }
}

/**
 * The state the button on screen 18 needs, read through the same pair the
 * refusal is written on, so the grey button and the action cannot disagree.
 */
export type DocumentBinState = {
  discardable: boolean;
  deletedAt: Date | null;
  reason: string | null;
};

export async function documentBinState(id: string): Promise<DocumentBinState> {
  const [row] = await db
    .select({
      number: document.number,
      lockedAt: document.lockedAt,
      deletedAt: document.deletedAt,
      reason: document.deleteReason,
    })
    .from(document)
    .where(eq(document.id, id))
    .limit(1);

  if (!row) return { discardable: false, deletedAt: null, reason: null };
  return {
    discardable: row.number === null && row.lockedAt === null,
    deletedAt: row.deletedAt,
    reason: row.reason,
  };
}

export async function discardDocument(opts: {
  id: string;
  reason: string;
  actorId: string;
  fromWhere?: string;
}): Promise<{ dealId: string | null }> {
  const [before] = await db.select().from(document).where(eq(document.id, opts.id)).limit(1);
  if (!before) throw new Error("No such document");
  if (before.number !== null || before.lockedAt !== null) {
    throw new DocumentIsIssued(before.kind, before.number);
  }
  if (before.deletedAt) return { dealId: before.dealId };

  await db
    .update(document)
    .set({
      deletedAt: new Date(),
      deletedBy: opts.actorId,
      deleteReason: opts.reason.trim() || null,
    })
    .where(eq(document.id, opts.id));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    entity: "document",
    entityId: opts.id,
    action: "discard",
    // The number is null and that is the entry's point: in two years this line
    // is the proof that what went in the bin had never been issued.
    before: { kind: before.kind, number: before.number },
    reason: opts.reason.trim() || null,
    sourceScreen: opts.fromWhere ?? "18",
  });

  return { dealId: before.dealId };
}

export async function restoreDocument(opts: { id: string; actorId: string }) {
  const [before] = await db.select().from(document).where(eq(document.id, opts.id)).limit(1);
  if (!before?.deletedAt) return;

  await db
    .update(document)
    .set({ deletedAt: null, deletedBy: null, deleteReason: null })
    .where(eq(document.id, opts.id));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    entity: "document",
    entityId: opts.id,
    action: "restore",
    after: { kind: before.kind, number: before.number },
    sourceScreen: "83",
  });
}

export type BinRow = {
  id: string;
  what: string;
  code: string;
  deletedAt: Date;
  reason: string | null;
  daysLeft: number;
};

/** Screen 83 — "restorable for 30 days, then the record is gone but its audit trail is not". */
export async function listBin(): Promise<BinRow[]> {
  const rows = await db
    .select({
      id: party.id,
      code: party.code,
      legalName: party.legalName,
      deletedAt: party.deletedAt,
      reason: party.deleteReason,
    })
    .from(party)
    .where(isNotNull(party.deletedAt))
    .orderBy(desc(party.deletedAt));

  return rows.map((r) => {
    const deletedAt = r.deletedAt as Date;
    const elapsed = Math.floor((Date.now() - deletedAt.getTime()) / 86_400_000);
    return {
      id: r.id,
      what: r.legalName,
      code: r.code,
      deletedAt,
      reason: r.reason,
      daysLeft: Math.max(0, BIN_DAYS - elapsed),
    };
  });
}

/**
 * Screen 83 — never a blank 404.
 *
 * A dead link inside your own system should say what used to be there and what
 * replaced it. That is the difference between a system people trust and one
 * they stop clicking in.
 */
export async function deletedPartyNotice(id: string) {
  const [row] = await db
    .select({
      id: party.id,
      code: party.code,
      legalName: party.legalName,
      deletedAt: party.deletedAt,
      reason: party.deleteReason,
    })
    .from(party)
    .where(and(eq(party.id, id), isNotNull(party.deletedAt)))
    .limit(1);

  if (!row?.deletedAt) return null;

  const elapsed = Math.floor((Date.now() - row.deletedAt.getTime()) / 86_400_000);
  return {
    ...row,
    deletedAt: row.deletedAt,
    daysLeft: Math.max(0, BIN_DAYS - elapsed),
  };
}

/**
 * Lists and search show only live companies: not binned, not archived, and not
 * merged away.
 *
 * The third one is the easy one to forget. `mergeParties` repoints nothing, so
 * a retired record is a perfectly normal row that would keep showing up in every
 * list unless each query remembers to exclude it — which is exactly the cost
 * written down in docs/DECISIONS/2026-08-21-merge-repoints-nothing.md. This
 * constant is how that cost is paid once instead of everywhere.
 */
export const liveParty = and(
  isNull(party.deletedAt),
  isNull(party.archivedAt),
  isNull(party.supersededBy),
);

/**
 * Lists show only live documents.
 *
 * Deliberately one clause where `liveParty` has three: a document is never
 * archived and never merged away. It is either a draft in the bin or it is
 * paper, and paper does not leave.
 *
 * Only the queries that can see a draft need this. Most readers of `document`
 * already filter `number is not null` — the ledger, the ageing, every
 * settlement — and a discarded row can never have a number, so adding it there
 * would be a clause that is true by construction. See docs/FIX-QUEUE.md,
 * "Known gaps", for the sites left uncovered and why.
 */
export const liveDocument = isNull(document.deletedAt);
