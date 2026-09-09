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
      priceQuotes: counted?.priceQuotes ?? 0,
      offersIssued: counted?.offersIssued ?? 0,
      ordersReceived: counted?.ordersReceived ?? 0,
      deliveriesIssued: counted?.deliveriesIssued ?? 0,
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
 * WHY A CONVERSION CAN BE UNDONE, and what stops it.
 *
 * `makeTender` is one press. A press that can only be reversed by opening
 * psql is not a reversible press, and misclassifying a deal is the ordinary
 * mistake here: a ZIP of eleven files is usually a tender and sometimes it is
 * a client sending eleven datasheets. So the undo exists, and everything
 * interesting about it is what it refuses.
 *
 * Removing a tender takes the `tender` row and its `tender_piece` rows with
 * it — the deal, its lines, its documents and its outcome are untouched,
 * because a tender IS a deal and this only removes the classification. So the
 * question each refusal answers is narrow: does one of those two tables hold
 * a fact that no other row in this database records? Each of the four is read
 * off `src/db/schema/tender.ts`, which says so in its own comments.
 *
 *  · `submitted_at` / `deposit_receipt_ref` — the schema: "no document in
 *    this system records that a man carried an envelope to a counter in
 *    Adrar." Nothing else knows, and it is no longer a classification anyway:
 *    it is a thing that happened.
 *
 *  · `caution_requested_at` / `caution_received_at` — the schema calls these
 *    "the two facts nobody can infer: the bank takes days". BOTH refuse, not
 *    only the received one. Asking the bank is itself an act nobody can
 *    reconstruct from anything else here, and a request in flight is a week
 *    of somebody's time that would vanish with the row.
 *
 *  · a piece with a `file_id`, or a piece somebody typed a `label` on — the
 *    seed inserts neither (`makeTender` writes `key`, `section`, `position`
 *    and `added_by`, and `addPiece` is the only writer of `label`). So either
 *    one means a person has read the cahier des charges and worked this
 *    folder, and that reading has no other home.
 *
 *  · `bpu_source` / `bpu_imported_at` — screen 42's provenance, "read from
 *    BPU.xls". The forty-two lines it produced live on the deal and survive;
 *    the record of where they came from lives here and would not.
 *
 * What deliberately does NOT refuse is the seed itself. Nineteen rows written
 * by `seedFor` and untouched since are a template's opinion, not anybody's
 * work — refusing on those would mean no conversion is ever undoable, which
 * is the situation this task exists to end.
 */
export const UNMAKE_REFUSALS = [
  "notATender",
  "alreadySubmitted",
  "cautionRecorded",
  "bpuImported",
  "folderStarted",
] as const;
export type UnmakeRefusal = (typeof UNMAKE_REFUSALS)[number];

type UnmakeRow = Pick<
  typeof tender.$inferSelect,
  | "submittedAt"
  | "depositReceiptRef"
  | "cautionRequestedAt"
  | "cautionReceivedAt"
  | "bpuSource"
  | "bpuImportedAt"
>;

/**
 * Pure, so the screen and the write cannot disagree.
 *
 * `Button`'s `disabledReason` sets `aria-disabled`, not `disabled` — a truly
 * disabled button fires no events and so can never be read aloud — which means
 * a greyed submit button still submits. The refusal therefore has to live in
 * the domain and be consulted twice: once by the page to grey the control and
 * name the reason, once by `unmakeTender` to actually say no.
 */
export function unmakeRefusalFor(
  row: UnmakeRow | undefined,
  pieces: { fileId: string | null; label: string | null }[],
): UnmakeRefusal | null {
  if (!row) return "notATender";
  if (row.submittedAt || row.depositReceiptRef) return "alreadySubmitted";
  if (row.cautionRequestedAt || row.cautionReceivedAt) return "cautionRecorded";
  if (row.bpuSource || row.bpuImportedAt) return "bpuImported";
  if (pieces.some((piece) => piece.fileId !== null || piece.label !== null)) return "folderStarted";
  return null;
}

/** Why this deal's conversion cannot be undone, for the screen. Null when it can. */
export async function unmakeTenderBlockedBy(dealId: string): Promise<UnmakeRefusal | null> {
  const [row] = await db.select().from(tender).where(eq(tender.dealId, dealId)).limit(1);
  const pieces = await db
    .select({ fileId: tenderPiece.fileId, label: tenderPiece.label })
    .from(tenderPiece)
    .where(eq(tenderPiece.dealId, dealId));
  return unmakeRefusalFor(row, pieces);
}

/**
 * Turn a tender back into an ordinary deal.
 *
 * The check is repeated INSIDE the transaction rather than trusted from the
 * page, because between drawing a live button and pressing it somebody in the
 * next room can record the caution.
 *
 * The row goes rather than gaining a `deleted_at`: `tender` has no deletion
 * columns and giving it three would mean every reader in this module and in
 * `bpu-store.ts` filtering on them forever, to hold a row that says only
 * "this deal answers a procedure" — a sentence, not a record. The precedent
 * is `removePiece` a few functions below, which has removed rather than
 * hidden since the module was written. What the HARD RULE actually asks for
 * is "an audit entry that outlives the record", so the whole row and every
 * piece key it carried are written into `before` first, and the audit trail
 * can still answer what this deal was classified as in September.
 */
export async function unmakeTender(opts: {
  dealId: string;
  actorId: string;
  reason?: string | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(tender).where(eq(tender.dealId, opts.dealId)).limit(1);
    const pieces = await tx
      .select()
      .from(tenderPiece)
      .where(eq(tenderPiece.dealId, opts.dealId))
      .orderBy(asc(tenderPiece.position));

    const refusal = unmakeRefusalFor(row, pieces);
    if (refusal) throw new TenderRefused(refusal);

    await tx.delete(tenderPiece).where(eq(tenderPiece.dealId, opts.dealId));
    await tx.delete(tender).where(eq(tender.dealId, opts.dealId));

    await tx.insert(auditEntry).values({
      entity: "tender",
      entityId: opts.dealId,
      // Not the generic "delete". The audit table prints the entity beside the
      // action, and "Tender · Deleted" reads as though a deal went missing —
      // what happened is that a classification was withdrawn and the deal is
      // still there.
      action: "unmake",
      actorId: opts.actorId,
      actorKind: "user",
      // Screen 06. The press is on the deal, which is where the mistake is
      // noticed — `makeTender` names 07 because that is the screen the folder
      // it seeds belongs to.
      sourceScreen: "06",
      before: {
        procedure: row?.procedure ?? null,
        submissionPlace: row?.submissionPlace ?? null,
        opensAt: row?.opensAt?.toISOString() ?? null,
        cautionAmount: row?.cautionAmount ?? null,
        cautionPct: row?.cautionPct ?? null,
        offerValidityDays: row?.offerValidityDays ?? null,
        pieces: pieces.map((piece) => piece.key),
      },
      reason: opts.reason?.trim() || null,
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
  fileName?: string | null;
  fileType?: string | null;
  note?: string | null;
  actorId: string;
}): Promise<void> {
  const [before] = await db
    .select()
    .from(companyCredential)
    .where(eq(companyCredential.key, opts.key))
    .limit(1);

  /**
   * A save with no new scan keeps the one already filed.
   *
   * The upsert replaces the whole row, so passing `fileId: undefined` from a
   * form where nobody attached anything would blank the path — and blanking
   * the path takes every piece this credential backs from `ready` to `missing`
   * on every open tender, because somebody corrected an expiry date. `null`
   * still means "take it off", which is a different press with its own button.
   */
  const keepingFile = opts.fileId === undefined;

  const values = {
    key: opts.key,
    reference: opts.reference ?? null,
    issuedOn: opts.issuedOn ?? null,
    expiresOn: opts.expiresOn ?? null,
    fileId: keepingFile ? (before?.fileId ?? null) : opts.fileId,
    fileName: keepingFile ? (before?.fileName ?? null) : (opts.fileName ?? null),
    fileType: keepingFile ? (before?.fileType ?? null) : (opts.fileType ?? null),
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

export type CredentialDetail = {
  key: string;
  reference: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  fileId: string | null;
  fileName: string | null;
  note: string | null;
  updatedAt: Date;
};

/**
 * The same rows, with the three fields `dossier()` has no use for.
 *
 * Kept apart from `credentials()` rather than widening it: `CredentialInput`
 * is the argument to a pure function, and the four fields on it are the four
 * that decide a piece's state. A form needs the issue date, the note and the
 * scan's name to show what is already filed, and none of those may reach
 * `pieceState` and start deciding anything.
 */
export async function credentialDetails(): Promise<Map<string, CredentialDetail>> {
  const rows = await db.select().from(companyCredential).orderBy(asc(companyCredential.key));
  return new Map(
    rows.map((row) => [
      row.key,
      {
        key: row.key,
        reference: row.reference,
        issuedOn: row.issuedOn,
        expiresOn: row.expiresOn,
        fileId: row.fileId,
        fileName: row.fileName,
        note: row.note,
        updatedAt: row.updatedAt,
      },
    ]),
  );
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

/**
 * When the envelope was deposited, or null. One column, no folder computed.
 *
 * `addPiece` and `removePiece` are refused after a deposit, and screen 08 greys
 * both buttons for the same reason — so the fact has to be readable twice, and
 * asking `getTender` for it would compute a nineteen-piece dossier to look at
 * one timestamp. A folder that was deposited is what was deposited: editing its
 * list afterwards rewrites the answer to "what did we hand over", which the
 * audit entry `markSubmitted` writes has already recorded.
 */
export async function tenderSubmittedAt(dealId: string): Promise<Date | null> {
  const [row] = await db
    .select({ submittedAt: tender.submittedAt })
    .from(tender)
    .where(eq(tender.dealId, dealId))
    .limit(1);
  return row?.submittedAt ?? null;
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

/**
 * What this tender does not ask for. Removed, not hidden.
 *
 * The HARD RULE's words are "an audit entry that outlives the record", and
 * until 9 September this wrote `{ removedPiece: <uuid> }` — the id of a row
 * that no longer exists, which outlives nothing anybody can read. The row is
 * read inside the transaction and written into `before` first, so the question
 * six months later ("who took the caution de soumission out of this folder,
 * and had it been filed?") has an answer. `unmakeTender` above already does
 * this for the whole folder; this is the same rule applied one row at a time.
 *
 * It also refuses a piece that is not this tender's, rather than silently
 * deleting nothing: a delete that matched no row used to return cleanly and
 * still write an audit entry saying a piece had been removed.
 */
export async function removePiece(opts: {
  dealId: string;
  pieceId: string;
  actorId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(tenderPiece)
      .where(and(eq(tenderPiece.id, opts.pieceId), eq(tenderPiece.dealId, opts.dealId)))
      .limit(1);
    if (!row) throw new TenderRefused("noSuchPiece");

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
      before: {
        removedPiece: row.id,
        key: row.key,
        label: row.label,
        section: row.section,
        credentialKey: row.credentialKey,
        fileId: row.fileId,
      },
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
