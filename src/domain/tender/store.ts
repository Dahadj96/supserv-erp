import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal } from "@/db/schema/deal";
import { party } from "@/db/schema/party";
import { companyCredential, tender, tenderPiece } from "@/db/schema/tender";
import { factsFor } from "../deal/deal";
import { badgeOf, type DealFacts, deadlineDisplay, type Outcome, type Stage } from "../deal/stage";
import {
  type CredentialInput,
  type Dossier,
  dossier,
  type PieceInput,
  type Procedure,
  type Section,
} from "./dossier";
import { seedFor } from "./pieces";

/**
 * Screens 07 and 08, against the database.
 *
 * A tender is a deal with a `tender` row, so everything here joins rather than
 * duplicates: the client, the subject, the deadline, the lines, the stage and
 * the outcome all come from the deal and its documents exactly as screen 05
 * computes them. What is added is the procedure, the bond and the folder.
 */

export class TenderRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "TenderRefused";
  }
}

export type TenderRow = {
  dealId: string;
  ref: string;
  clientReference: string | null;
  authority: string;
  object: string;
  procedure: string;
  submissionMethod: string;
  cautionAmount: string | null;
  currency: string;
  /** Whole percent of the folder that is ready. */
  percent: number;
  blocking: number;
  closesAt: Date | null;
  deadline: ReturnType<typeof deadlineDisplay>;
  submittedAt: Date | null;
  badge: Stage | Outcome;
};

/** All of them, with the folder computed for each. */
export async function listTenders(now = new Date()): Promise<TenderRow[]> {
  const rows = await db
    .select({
      dealId: tender.dealId,
      ref: deal.ref,
      clientReference: deal.clientReference,
      object: deal.subject,
      authority: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      procedure: tender.procedure,
      submissionMethod: deal.submissionMethod,
      cautionAmount: tender.cautionAmount,
      currency: deal.currency,
      closesAt: deal.deadlineAt,
      submittedAt: tender.submittedAt,
      decision: deal.decision,
      lostAt: deal.lostAt,
      lineCount: sql<number>`(select count(*)::int from deal_line where deal_id = ${deal.id})`,
    })
    .from(tender)
    .innerJoin(deal, eq(deal.id, tender.dealId))
    .leftJoin(party, eq(party.id, deal.partyId))
    .where(sql`${deal.deletedAt} is null`)
    .orderBy(asc(deal.deadlineAt), desc(deal.createdAt));

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.dealId);
  const [facts, folders] = await Promise.all([factsFor(ids), foldersFor(ids, now)]);

  return rows.map((row) => {
    // `factsFor` counts documents and sourcing; the decision, the loss and the
    // line count come off the deal row itself, and both halves are needed
    // before `badgeOf` can say whether this one was won.
    const counted = facts.get(row.dealId);
    const dealFacts: DealFacts = {
      decision: (row.decision as DealFacts["decision"]) ?? null,
      lostAt: row.lostAt,
      lineCount: row.lineCount,
      suppliersAsked: counted?.suppliersAsked ?? 0,
      offersIssued: counted?.offersIssued ?? 0,
      ordersReceived: counted?.ordersReceived ?? 0,
      invoicesIssued: counted?.invoicesIssued ?? 0,
    };
    const folder = folders.get(row.dealId);

    return {
      dealId: row.dealId,
      ref: row.ref,
      clientReference: row.clientReference,
      authority: row.authority ?? "—",
      object: row.object,
      procedure: row.procedure,
      submissionMethod: row.submissionMethod,
      cautionAmount: row.cautionAmount,
      currency: row.currency,
      percent: folder?.percent ?? 0,
      blocking: folder?.blocking.length ?? 0,
      closesAt: row.closesAt,
      deadline: deadlineDisplay(dealFacts, row.closesAt, now),
      submittedAt: row.submittedAt,
      badge: badgeOf(dealFacts),
    };
  });
}

/**
 * The folder for many tenders in three queries rather than three per tender.
 *
 * Screen 07 prints a completeness bar on every row, and the honest way to fill
 * it is to compute it — there is no stored percentage, for the same reason
 * there is no stored stage. That costs one query for the pieces and one for the
 * credentials, whatever the number of rows.
 */
async function foldersFor(dealIds: string[], now: Date): Promise<Map<string, Dossier>> {
  const [pieces, credentials, deadlines] = await Promise.all([
    db.select().from(tenderPiece).where(inArray(tenderPiece.dealId, dealIds)),
    db.select().from(companyCredential),
    db
      .select({ id: deal.id, deadlineAt: deal.deadlineAt })
      .from(deal)
      .where(inArray(deal.id, dealIds)),
  ]);

  const closes = new Map(deadlines.map((d) => [d.id, d.deadlineAt]));
  const creds: CredentialInput[] = credentials.map((c) => ({
    key: c.key,
    reference: c.reference,
    expiresOn: c.expiresOn,
    fileId: c.fileId,
  }));

  const out = new Map<string, Dossier>();
  for (const dealId of dealIds) {
    const mine: PieceInput[] = pieces
      .filter((p) => p.dealId === dealId)
      .map((p) => ({
        key: p.key,
        section: p.section as Section,
        label: p.label,
        position: p.position,
        credentialKey: p.credentialKey,
        fileId: p.fileId,
      }));
    out.set(
      dealId,
      dossier({ pieces: mine, credentials: creds, now, closesAt: closes.get(dealId) ?? null }),
    );
  }
  return out;
}

export type TenderDetail = {
  dealId: string;
  ref: string;
  clientReference: string | null;
  authority: string;
  object: string;
  procedure: string;
  submissionMethod: string;
  submissionPlace: string | null;
  closesAt: Date | null;
  opensAt: Date | null;
  cautionAmount: string | null;
  cautionPct: string | null;
  cautionRequestedAt: Date | null;
  cautionReceivedAt: Date | null;
  offerValidityDays: number | null;
  requiredValidityDays: number | null;
  currency: string;
  submittedAt: Date | null;
  depositReceiptRef: string | null;
  folder: Dossier;
};

export async function getTender(dealId: string, now = new Date()): Promise<TenderDetail | null> {
  const [row] = await db
    .select({
      dealId: tender.dealId,
      ref: deal.ref,
      clientReference: deal.clientReference,
      object: deal.subject,
      authority: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      procedure: tender.procedure,
      submissionMethod: deal.submissionMethod,
      submissionPlace: tender.submissionPlace,
      closesAt: deal.deadlineAt,
      opensAt: tender.opensAt,
      cautionAmount: tender.cautionAmount,
      cautionPct: tender.cautionPct,
      cautionRequestedAt: tender.cautionRequestedAt,
      cautionReceivedAt: tender.cautionReceivedAt,
      offerValidityDays: tender.offerValidityDays,
      requiredValidityDays: deal.requiredValidityDays,
      currency: deal.currency,
      submittedAt: tender.submittedAt,
      depositReceiptRef: tender.depositReceiptRef,
    })
    .from(tender)
    .innerJoin(deal, eq(deal.id, tender.dealId))
    .leftJoin(party, eq(party.id, deal.partyId))
    .where(eq(tender.dealId, dealId))
    .limit(1);

  if (!row) return null;

  const folders = await foldersFor([dealId], now);
  const folder = folders.get(dealId);
  if (!folder) return null;

  return { ...row, authority: row.authority ?? "—", folder };
}

/**
 * Turn an existing enquiry into a tender, and seed its folder.
 *
 * The deal comes first and is created the ordinary way — screen 06 is still the
 * screen for what the client asked for. This adds the procedure and the folder,
 * so a tender that turns out to be an ordinary consultation loses nothing by
 * having been recorded as an enquiry first.
 */
export async function makeTender(opts: {
  dealId: string;
  procedure: Procedure;
  submissionPlace?: string | null;
  opensAt?: Date | null;
  cautionAmount?: string | null;
  cautionPct?: string | null;
  offerValidityDays?: number | null;
  actorId: string;
}): Promise<void> {
  const [found] = await db.select().from(deal).where(eq(deal.id, opts.dealId)).limit(1);
  if (!found) throw new TenderRefused("noSuchDeal");

  const [already] = await db
    .select({ dealId: tender.dealId })
    .from(tender)
    .where(eq(tender.dealId, opts.dealId))
    .limit(1);
  if (already) throw new TenderRefused("alreadyATender");

  await db.transaction(async (tx) => {
    await tx.insert(tender).values({
      dealId: opts.dealId,
      procedure: opts.procedure,
      submissionPlace: opts.submissionPlace ?? null,
      opensAt: opts.opensAt ?? null,
      cautionAmount: opts.cautionAmount ?? null,
      cautionPct: opts.cautionPct ?? null,
      offerValidityDays: opts.offerValidityDays ?? null,
    });

    // The seed, copied in and owned by this tender from now on. Nothing reads
    // the seed again — a piece removed here stays removed, and one added by a
    // person is indistinguishable from one that arrived with the template,
    // which is right: both are somebody's reading of the cahier des charges.
    const seeds = seedFor(opts.procedure);
    await tx.insert(tenderPiece).values(
      seeds.map((seed, index) => ({
        dealId: opts.dealId,
        section: seed.section,
        position: index + 1,
        key: seed.key,
        credentialKey: seed.credentialKey,
        addedBy: opts.actorId,
      })),
    );

    await tx.insert(auditEntry).values({
      entity: "tender",
      entityId: opts.dealId,
      action: "create",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "07",
      after: { procedure: opts.procedure, pieces: seeds.length },
    });
  });
}

/**
 * The company's papers. One row per key, upserted.
 *
 * `updatedBy` and an audit entry on every write, because an expiry date is the
 * kind of field somebody corrects at speed the morning of a deposit, and six
 * months later the question is who changed it.
 */
export async function saveCredential(opts: {
  key: string;
  reference?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  fileId?: string | null;
  note?: string | null;
  actorId: string;
}): Promise<void> {
  const [before] = await db
    .select()
    .from(companyCredential)
    .where(eq(companyCredential.key, opts.key))
    .limit(1);

  const values = {
    key: opts.key,
    reference: opts.reference ?? null,
    issuedOn: opts.issuedOn ?? null,
    expiresOn: opts.expiresOn ?? null,
    fileId: opts.fileId ?? null,
    note: opts.note ?? null,
    updatedBy: opts.actorId,
    updatedAt: new Date(),
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(companyCredential)
      .values(values)
      .onConflictDoUpdate({ target: companyCredential.key, set: values });

    await tx.insert(auditEntry).values({
      entity: "company_credential",
      entityId: opts.key,
      action: before ? "update" : "create",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "08",
      before: before ? { expiresOn: before.expiresOn, fileId: before.fileId } : null,
      after: { expiresOn: values.expiresOn, fileId: values.fileId },
    });
  });
}

export async function credentials(): Promise<CredentialInput[]> {
  const rows = await db.select().from(companyCredential).orderBy(asc(companyCredential.key));
  return rows.map((row) => ({
    key: row.key,
    reference: row.reference,
    expiresOn: row.expiresOn,
    fileId: row.fileId,
  }));
}

/**
 * That the envelope was deposited.
 *
 * Refused when the folder still has a blocking piece, and this is the one place
 * in the tender module that says no. Marking a tender submitted while the
 * CASNOS attestation expires before the deposit date records something that did
 * not happen the way it is written down — the envelope was refused at the desk,
 * or it was deposited knowing it would be. Either is worth a sentence.
 *
 * `force` exists because the second case is real: a company does sometimes
 * deposit an incomplete folder deliberately, to be seen to have bid. It takes
 * a reason, and the reason goes in the log.
 */
export async function markSubmitted(opts: {
  dealId: string;
  actorId: string;
  depositReceiptRef?: string | null;
  force?: boolean;
  reason?: string | null;
  now?: Date;
}): Promise<void> {
  const now = opts.now ?? new Date();
  const detail = await getTender(opts.dealId, now);
  if (!detail) throw new TenderRefused("noSuchTender");
  if (detail.submittedAt) throw new TenderRefused("alreadySubmitted");

  if (detail.folder.blocking.length > 0 && !opts.force) {
    throw new TenderRefused("dossierIncomplete");
  }
  if (detail.folder.blocking.length > 0 && !opts.reason?.trim()) {
    throw new TenderRefused("reasonRequired");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(tender)
      .set({
        submittedAt: now,
        submittedBy: opts.actorId,
        depositReceiptRef: opts.depositReceiptRef ?? null,
      })
      .where(eq(tender.dealId, opts.dealId));

    await tx.insert(auditEntry).values({
      entity: "tender",
      entityId: opts.dealId,
      action: "submit",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "08",
      after: {
        depositReceiptRef: opts.depositReceiptRef ?? null,
        blockingAtDeposit: detail.folder.blocking.map((p) => p.key),
        reason: opts.reason?.trim() || null,
      },
    });
  });
}

/** The bank takes days. Both dates are facts nobody can infer. */
export async function recordCaution(opts: {
  dealId: string;
  requestedAt?: Date | null;
  receivedAt?: Date | null;
  actorId: string;
}): Promise<void> {
  const set: Partial<typeof tender.$inferInsert> = {};
  if (opts.requestedAt !== undefined) set.cautionRequestedAt = opts.requestedAt;
  if (opts.receivedAt !== undefined) set.cautionReceivedAt = opts.receivedAt;
  if (Object.keys(set).length === 0) return;

  await db.transaction(async (tx) => {
    await tx.update(tender).set(set).where(eq(tender.dealId, opts.dealId));
    await tx.insert(auditEntry).values({
      entity: "tender",
      entityId: opts.dealId,
      action: "update",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "08",
      after: set,
    });
  });
}

/** How many tenders are open, closing, and carrying an incomplete folder. */
export async function tenderCounts(now = new Date()) {
  const rows = await listTenders(now);
  const closingSoon = rows.filter(
    (row) =>
      row.submittedAt === null &&
      row.closesAt !== null &&
      row.closesAt.getTime() > now.getTime() &&
      row.closesAt.getTime() - now.getTime() < 48 * 3_600_000,
  ).length;

  return {
    all: rows.length,
    open: rows.filter((r) => r.submittedAt === null && r.badge !== "lost" && r.badge !== "noBid")
      .length,
    submitted: rows.filter((r) => r.submittedAt !== null).length,
    awarded: rows.filter((r) => r.badge === "won").length,
    lost: rows.filter((r) => r.badge === "lost").length,
    closingSoon,
    incomplete: rows.filter((r) => r.submittedAt === null && r.blocking > 0).length,
  };
}

/** Every tender whose folder is held up, for the count on screen 07's header. */
export async function tendersWithBlockedFolders(now = new Date()): Promise<TenderRow[]> {
  const rows = await listTenders(now);
  return rows.filter((row) => row.submittedAt === null && row.blocking > 0);
}

/** Used by the piece rows on screen 08 to know what may be attached. */
export async function piecesFor(dealId: string) {
  return db
    .select()
    .from(tenderPiece)
    .where(eq(tenderPiece.dealId, dealId))
    .orderBy(asc(tenderPiece.position));
}

/** A piece this tender's cahier des charges asks for and the seed did not. */
export async function addPiece(opts: {
  dealId: string;
  section: Section;
  key: string;
  label: string;
  credentialKey?: string | null;
  actorId: string;
}): Promise<void> {
  if (!opts.label.trim()) throw new TenderRefused("labelRequired");

  const existing = await piecesFor(opts.dealId);
  await db.insert(tenderPiece).values({
    dealId: opts.dealId,
    section: opts.section,
    position: existing.length + 1,
    key: opts.key,
    label: opts.label.trim(),
    credentialKey: opts.credentialKey ?? null,
    addedBy: opts.actorId,
  });
}

/** What this tender does not ask for. Removed, not hidden. */
export async function removePiece(opts: {
  dealId: string;
  pieceId: string;
  actorId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(tenderPiece)
      .where(and(eq(tenderPiece.id, opts.pieceId), eq(tenderPiece.dealId, opts.dealId)));
    await tx.insert(auditEntry).values({
      entity: "tender",
      entityId: opts.dealId,
      action: "update",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "08",
      after: { removedPiece: opts.pieceId },
    });
  });
}

/** Everything that has been deposited, for the awarded/lost follow-up. */
export async function submittedTenders(): Promise<string[]> {
  const rows = await db
    .select({ dealId: tender.dealId })
    .from(tender)
    .where(isNotNull(tender.submittedAt));
  return rows.map((r) => r.dealId);
}
