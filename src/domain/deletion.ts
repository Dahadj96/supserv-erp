import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine } from "@/db/schema/deal";
import { document } from "@/db/schema/document";
import { note } from "@/db/schema/note";
import { party, person } from "@/db/schema/party";
import { projectCrew } from "@/db/schema/project";
import { sourcingRequest } from "@/db/schema/sourcing";
import { tender } from "@/db/schema/tender";

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

/**
 * Exported because screen 22 asks the same question the refusal asks, one
 * moment earlier. The button there used to submit, be refused and come back
 * with a banner; a control that can already know it will refuse should say so
 * while it is still grey. One query, one rule, two callers that cannot disagree.
 */
export async function issuedDocumentCount(partyId: string): Promise<number> {
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

/**
 * V1 — WHAT GOES WITH IT.
 *
 * `discardDeal` used to write ONE row: `deleted_at` on the deal. The foreign
 * keys look like they would take care of the rest and do not — `deal_line` is
 * `ON DELETE cascade` and `price_quote.deal_id` is `ON DELETE set null`, and
 * both fire on a HARD delete, which this system never does.
 *
 * So the state before this was: an enquiry out of every list, with its unissued
 * proforma still sitting on `/offers` pointing at a deal nobody could open —
 * and that draft was not in the bin either, because the bin lists a document
 * only when the DOCUMENT's own `deleted_at` is set.
 *
 * This says, before the confirmation is shown, exactly what the discard will
 * take. The same function answers the refusal: if issued documents exist, it
 * names them, because "this enquiry has 1 issued document" is a fact somebody
 * then has to go and find, and naming FA-2026-0007 is not.
 */
export type DealDiscardEffect = {
  /** Drafts that will go to the bin with it, and come back with it. */
  drafts: { id: string; kind: string }[];
  /** Rows only reachable through the deal — counted so the sentence is true. */
  lines: number;
  sourcingRequests: number;
  hasTender: boolean;
  /**
   * Issued documents. Non-empty means the discard REFUSES (LAW 5): the paper
   * has left the building and a bin is not a correction — an avoir is.
   */
  issued: { id: string; kind: string; number: string | null }[];
};

export async function dealDiscardEffect(dealId: string): Promise<DealDiscardEffect> {
  const [documents, lines, requests, tenders] = await Promise.all([
    db
      .select({
        id: document.id,
        kind: document.kind,
        number: document.number,
        lockedAt: document.lockedAt,
      })
      .from(document)
      .where(and(eq(document.dealId, dealId), liveDocument)),
    db.select({ n: sql<number>`count(*)::int` }).from(dealLine).where(eq(dealLine.dealId, dealId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(sourcingRequest)
      .where(eq(sourcingRequest.dealId, dealId)),
    db.select({ n: sql<number>`count(*)::int` }).from(tender).where(eq(tender.dealId, dealId)),
  ]);

  // The same pair `discardDocument` refuses on, and for the same reason: a
  // client's bon de commande carries THEIR reference and never takes one of
  // ours, so `number` alone would let a locked order through.
  const issued = documents.filter((d) => d.number !== null || d.lockedAt !== null);
  const drafts = documents.filter((d) => d.number === null && d.lockedAt === null);

  return {
    drafts: drafts.map((d) => ({ id: d.id, kind: d.kind })),
    lines: lines[0]?.n ?? 0,
    sourcingRequests: requests[0]?.n ?? 0,
    hasTender: (tenders[0]?.n ?? 0) > 0,
    issued: issued.map((d) => ({ id: d.id, kind: d.kind, number: d.number })),
  };
}

/**
 * Which issued document refused, so the banner can name it.
 *
 * `NotDiscardable` carries a count because that is all a company's refusal can
 * honestly offer — a company may have hundreds. An enquiry has a handful, and
 * "FA-2026-0007 has been issued" is a sentence somebody can act on where
 * "1 issued document" is a sentence somebody has to go and investigate.
 */
export class DealNotDiscardable extends NotDiscardable {
  constructor(readonly documents: { kind: string; number: string | null }[]) {
    super(documents.length);
  }
}

export async function discardDeal(opts: {
  id: string;
  reason: string;
  actorId: string;
  fromWhere?: string;
}) {
  const effect = await dealDiscardEffect(opts.id);
  if (effect.issued.length > 0) {
    throw new DealNotDiscardable(effect.issued.map(({ kind, number }) => ({ kind, number })));
  }

  const [before] = await db.select().from(deal).where(eq(deal.id, opts.id)).limit(1);
  if (!before) throw new Error("No such enquiry");
  if (before.deletedAt) return;

  const reason = opts.reason.trim() || null;

  /*
   * ONE instant for every row this act touches, and that is not cosmetic.
   *
   * Restore has to put back exactly what THIS discard took, and no more: a
   * draft somebody binned on Tuesday for its own reasons must not come back
   * because the enquiry was restored on Friday. Sharing the timestamp makes
   * "binned by this act" a fact the rows carry themselves, so restore needs no
   * new column and no marker in a reason string to find them again.
   */
  const at = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(deal)
      .set({ deletedAt: at, deletedBy: opts.actorId, deleteReason: reason })
      .where(eq(deal.id, opts.id));

    if (effect.drafts.length > 0) {
      await tx
        .update(document)
        .set({ deletedAt: at, deletedBy: opts.actorId, deleteReason: reason })
        .where(
          and(
            eq(document.dealId, opts.id),
            isNull(document.number),
            isNull(document.lockedAt),
            isNull(document.deletedAt),
          ),
        );
    }

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      entity: "deal",
      entityId: opts.id,
      action: "discard",
      before: { ref: before.ref, subject: before.subject },
      // What went with it. The audit entry outlives the rows, so in two years
      // this line is the only place that says the enquiry did not go alone.
      after: {
        drafts: effect.drafts.length,
        lines: effect.lines,
        sourcingRequests: effect.sourcingRequests,
        tender: effect.hasTender,
      },
      reason,
      sourceScreen: opts.fromWhere ?? "06",
    });

    // One entry per draft, so the bin's restore and the document's own history
    // both read the same way whether it was binned alone or with its enquiry.
    if (effect.drafts.length > 0) {
      await tx.insert(auditEntry).values(
        effect.drafts.map((draft) => ({
          actorId: opts.actorId,
          entity: "document",
          entityId: draft.id,
          action: "discard",
          before: { kind: draft.kind, number: null },
          after: { withDeal: before.ref },
          reason,
          sourceScreen: opts.fromWhere ?? "06",
        })),
      );
    }
  });
}

export async function restoreDeal(opts: { id: string; actorId: string }) {
  const [before] = await db.select().from(deal).where(eq(deal.id, opts.id)).limit(1);
  if (!before?.deletedAt) return;

  const at = before.deletedAt;

  /*
   * Exactly what went down with it, and nothing else — see the note in
   * `discardDeal`. A draft binned separately has a different `deleted_at` and
   * stays in the bin, where its own row can restore it.
   */
  const withIt = await db
    .select({ id: document.id, kind: document.kind })
    .from(document)
    .where(and(eq(document.dealId, opts.id), eq(document.deletedAt, at)));

  await db.transaction(async (tx) => {
    await tx
      .update(deal)
      .set({ deletedAt: null, deletedBy: null, deleteReason: null })
      .where(eq(deal.id, opts.id));

    if (withIt.length > 0) {
      await tx
        .update(document)
        .set({ deletedAt: null, deletedBy: null, deleteReason: null })
        .where(and(eq(document.dealId, opts.id), eq(document.deletedAt, at)));
    }

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      entity: "deal",
      entityId: opts.id,
      action: "restore",
      after: { ref: before.ref, subject: before.subject, drafts: withIt.length },
      sourceScreen: "83",
    });

    if (withIt.length > 0) {
      await tx.insert(auditEntry).values(
        withIt.map((draft) => ({
          actorId: opts.actorId,
          entity: "document",
          entityId: draft.id,
          action: "restore",
          after: { kind: draft.kind, number: null, withDeal: before.ref },
          sourceScreen: "83",
        })),
      );
    }
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

/**
 * The same three words, applied to a person — a buyer at a client, a welder, a
 * candidate who never called back. Screens 76 and 51.
 *
 * This is where the junk is heaviest, and by design. A name is the cheapest row
 * in this system to create: `newContact` and `addPerson` both ask for two
 * fields and no permission beyond being able to write at all, because a name
 * given on the phone has to be writable before it is forgotten. What that buys
 * is a list that only ever grows — every misspelling, every duplicate, every
 * person typed while learning the screen. `person.deleted_at` has been migrated
 * since phase 1 and twelve queries already filter on it. Nothing wrote it.
 *
 * The refusal here is not about issued paper. A person is never the
 * counterparty on a document — a company is — so the guard that stops a company
 * and an enquiry has nothing to bite on. It is about a man standing on a site.
 * `project_crew` points at `person.id`, and screen 16 answers "who is on Adrar
 * centre today, and whose habilitation expires this month" out of it. Binning
 * somebody who has not left the crew makes that answer point at a row no list
 * will show, so the refusal names the fix instead: take them off the crew
 * first, then bin the name.
 */
export class PersonOnSite extends Error {
  constructor(readonly siteCount: number) {
    super("personIsOnSite");
  }
}

/**
 * How many sites each of these people has not left. Batched, because both
 * screens that offer the control render a list, and asking per row would be one
 * query per name on a page that already has one.
 */
export async function peopleOnSite(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({ personId: projectCrew.personId, n: sql<number>`count(*)::int` })
    .from(projectCrew)
    // `left_on` is the only column that says somebody has gone. A crew row with
    // no `on_site_since` is somebody put forward and not yet there, and screen
    // 16 draws that as its own state — proposed is not absent.
    .where(and(inArray(projectCrew.personId, ids), isNull(projectCrew.leftOn)))
    .groupBy(projectCrew.personId);

  return new Map(rows.map((r) => [r.personId, r.n]));
}

export async function discardPerson(opts: {
  id: string;
  reason: string;
  actorId: string;
  fromWhere?: string;
}) {
  const onSite = (await peopleOnSite([opts.id])).get(opts.id) ?? 0;
  if (onSite > 0) throw new PersonOnSite(onSite);

  const [before] = await db.select().from(person).where(eq(person.id, opts.id)).limit(1);
  if (!before) throw new Error("No such person");
  if (before.deletedAt) return;

  await db
    .update(person)
    .set({
      deletedAt: new Date(),
      deletedBy: opts.actorId,
      deleteReason: opts.reason.trim() || null,
    })
    .where(eq(person.id, opts.id));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    entity: "person",
    entityId: opts.id,
    action: "discard",
    before: { fullName: before.fullName, trade: before.trade },
    reason: opts.reason.trim() || null,
    sourceScreen: opts.fromWhere ?? "76",
  });
}

export async function restorePerson(opts: { id: string; actorId: string }) {
  const [before] = await db.select().from(person).where(eq(person.id, opts.id)).limit(1);
  if (!before?.deletedAt) return;

  await db
    .update(person)
    .set({ deletedAt: null, deletedBy: null, deleteReason: null })
    .where(eq(person.id, opts.id));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    entity: "person",
    entityId: opts.id,
    action: "restore",
    after: { fullName: before.fullName, trade: before.trade },
    sourceScreen: "83",
  });
}

/**
 * And to a note — the one row on a deal timeline that nothing else in the
 * system holds a copy of. Screen 56.
 *
 * Everything else on that page is derived: a message arrived, a quote came
 * back, a document was issued. A note exists because somebody put the phone
 * down and typed it, which is also why it is the row most likely to be wrong —
 * the wrong deal, the wrong date, half a sentence sent by an accidental Enter.
 * Until now it could be written and never unwritten.
 *
 * Who may bin one is not the same question as who may bin a company. Writing a
 * note takes `canWrite` — everybody but `lecture` — and `records.delete` is the
 * Gérant's alone, so a rule of "only the Gérant" would mean a Commercial who
 * mistypes their own note in Adrar waits for somebody in the office to fix it.
 * So: your own note is yours, and anybody else's takes `records.delete`. The
 * caller decides that, because the permission table lives in `src/auth/can.ts`
 * and this file does not read roles.
 */
export class NotYourNote extends Error {
  constructor(readonly authorId: string) {
    super("notYourNote");
  }
}

export async function discardNote(opts: {
  id: string;
  reason: string;
  actorId: string;
  /** True when the caller holds `records.delete`. Everybody else: own notes. */
  anyAuthor: boolean;
  fromWhere?: string;
}): Promise<{ entity: string; entityId: string }> {
  const [before] = await db.select().from(note).where(eq(note.id, opts.id)).limit(1);
  if (!before) throw new Error("No such note");
  if (!opts.anyAuthor && before.authorId !== opts.actorId) {
    throw new NotYourNote(before.authorId);
  }
  if (before.deletedAt) return { entity: before.entity, entityId: before.entityId };

  await db
    .update(note)
    .set({
      deletedAt: new Date(),
      deletedBy: opts.actorId,
      deleteReason: opts.reason.trim() || null,
    })
    .where(eq(note.id, opts.id));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    entity: "note",
    entityId: opts.id,
    action: "discard",
    // What it said and what it was about. The body is the whole record, so the
    // audit entry keeps the first line of it: in two years "a note was removed"
    // answers nothing, and "a note reading 'deposit window is 08:00' was
    // removed from AFF-0231" answers the question somebody is asking.
    before: {
      about: `${before.entity}:${before.entityId}`,
      kind: before.kind,
      said: before.body.slice(0, 200),
    },
    reason: opts.reason.trim() || null,
    sourceScreen: opts.fromWhere ?? "56",
  });

  return { entity: before.entity, entityId: before.entityId };
}

export async function restoreNote(opts: { id: string; actorId: string }) {
  const [before] = await db.select().from(note).where(eq(note.id, opts.id)).limit(1);
  if (!before?.deletedAt) return;

  await db
    .update(note)
    .set({ deletedAt: null, deletedBy: null, deleteReason: null })
    .where(eq(note.id, opts.id));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    entity: "note",
    entityId: opts.id,
    action: "restore",
    after: { about: `${before.entity}:${before.entityId}`, kind: before.kind },
    sourceScreen: "83",
  });
}

/**
 * Screen 83 holds five kinds of record now, and a person who has just lost one
 * does not remember which kind it was — that is the whole reason to open a
 * bin. So a row says what it is, and carries the least a person needs to
 * recognise it without clicking.
 */
export type BinKind = "company" | "deal" | "document" | "person" | "note";

export type BinRow = {
  kind: BinKind;
  id: string;
  /**
   * The line the row leads with. A company's legal name and an enquiry's
   * subject are already human text; a document's is its `kind`, which is a key
   * and not a word, because a kind has a name in each language and the bin is
   * not where translation belongs. The screen translates that one.
   */
  what: string;
  /**
   * What identifies it beside the label: a company's code, a deal's ref, a
   * person's trade. Empty for a document — a draft is discardable precisely
   * because it never took a number, so there is nothing to print here and the
   * screen says that in words rather than leaving a gap — and empty for a note,
   * whose first line IS the label and which has never had a second identifier.
   */
  code: string;
  deletedAt: Date;
  reason: string | null;
  daysLeft: number;
};

function binRow(
  kind: BinKind,
  r: { id: string; what: string; code: string; deletedAt: Date | null; reason: string | null },
): BinRow {
  const deletedAt = r.deletedAt as Date;
  const elapsed = Math.floor((Date.now() - deletedAt.getTime()) / 86_400_000);
  return {
    kind,
    id: r.id,
    what: r.what,
    code: r.code,
    deletedAt,
    reason: r.reason,
    // Unchanged, and deliberately: `BIN_DAYS` counts down on screen and
    // nothing purges at zero. See docs/FIX-QUEUE.md, "Known gaps".
    daysLeft: Math.max(0, BIN_DAYS - elapsed),
  };
}

/** Screen 83 — "restorable for 30 days, then the record is gone but its audit trail is not". */
export async function listBin(): Promise<BinRow[]> {
  /**
   * Five queries and one sort rather than one SQL union: the five tables have
   * five shapes, a union would need every column cast to a common one for no
   * gain, and the bin holds what a handful of people binned in the last thirty
   * days. What matters is that the order is across the whole set — a company
   * binned this morning sits above a deal binned last week, rather than each
   * kind being sorted under its own heading.
   */
  const [parties, deals, documents, people, notes] = await Promise.all([
    db
      .select({
        id: party.id,
        what: party.legalName,
        code: party.code,
        deletedAt: party.deletedAt,
        reason: party.deleteReason,
      })
      .from(party)
      .where(isNotNull(party.deletedAt)),
    db
      .select({
        id: deal.id,
        what: deal.subject,
        code: deal.ref,
        deletedAt: deal.deletedAt,
        reason: deal.deleteReason,
      })
      .from(deal)
      .where(isNotNull(deal.deletedAt)),
    db
      .select({
        id: document.id,
        what: document.kind,
        deletedAt: document.deletedAt,
        reason: document.deleteReason,
      })
      .from(document)
      .where(isNotNull(document.deletedAt)),
    db
      .select({
        id: person.id,
        what: person.fullName,
        code: person.trade,
        deletedAt: person.deletedAt,
        reason: person.deleteReason,
      })
      .from(person)
      .where(isNotNull(person.deletedAt)),
    db
      .select({
        id: note.id,
        what: note.body,
        deletedAt: note.deletedAt,
        reason: note.deleteReason,
      })
      .from(note)
      .where(isNotNull(note.deletedAt)),
  ]);

  return [
    ...parties.map((r) => binRow("company", r)),
    ...deals.map((r) => binRow("deal", r)),
    ...documents.map((r) => binRow("document", { ...r, code: "" })),
    ...people.map((r) => binRow("person", r)),
    // A note is its body. One line of it is what a person recognises, and the
    // whole of it would be a paragraph in a table cell.
    ...notes.map((r) =>
      binRow("note", { ...r, what: r.what.split("\n")[0]?.slice(0, 120) ?? "", code: "" }),
    ),
  ].sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
}

/**
 * How many records are in the bin, without building any of them — task U3.
 *
 * The settings hub prints this as a chip, and a chip is not worth five selects
 * of every column plus a sort. Five counts across the same five tables
 * `listBin` reads, so the number on the hub and the number of rows on screen 83
 * cannot disagree.
 */
export async function countBin(): Promise<number> {
  const n = sql<number>`count(*)::int`;
  const [parties, deals, documents, people, notes] = await Promise.all([
    db.select({ n }).from(party).where(isNotNull(party.deletedAt)),
    db.select({ n }).from(deal).where(isNotNull(deal.deletedAt)),
    db.select({ n }).from(document).where(isNotNull(document.deletedAt)),
    db.select({ n }).from(person).where(isNotNull(person.deletedAt)),
    db.select({ n }).from(note).where(isNotNull(note.deletedAt)),
  ]);
  return (
    (parties[0]?.n ?? 0) +
    (deals[0]?.n ?? 0) +
    (documents[0]?.n ?? 0) +
    (people[0]?.n ?? 0) +
    (notes[0]?.n ?? 0)
  );
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

/* ─────────────────────────── V3 · delete forever ───────────────────────────
 *
 * `BIN_DAYS` counted down on screen and nothing purged at zero. Line 543 of
 * this file used to say so out loud, `grep purge` returned nothing, and screen
 * 83 drew "gone in 4 days" beside rows that would still be there in a year.
 *
 * That is worse than not having a bin. A countdown that does not happen teaches
 * a person that the numbers in this system are decoration, and once that is
 * learned it applies to the ageing ladder and the folder deadline too.
 *
 * So: a purge exists, and it is deliberately the narrowest thing that could
 * work.
 *
 *   ONE ROW AT A TIME.  Not "empty the bin". There is no button in this ERP
 *                       that destroys a set of records, and there should not be.
 *   THE GÉRANT ONLY.    `records.purge`, its own permission, held by nobody
 *                       else — including whoever put the row in the bin.
 *   TYPED CONFIRMATION. The screen asks for the record's own code back.
 *   NEVER ISSUED PAPER. Checked here, not left to a foreign key.
 *   THE AUDIT SURVIVES. The entry is written in the same transaction as the
 *                       delete, and outlives the row by design — in two years
 *                       it is the only thing that says the record existed.
 *
 * And the honest part: STRUCTURE IS NOT GUESSED. Thirty-eight foreign keys
 * point at these five tables and twenty of them are ON DELETE NO ACTION. Rather
 * than hand-maintaining a list of them here — which would be wrong the first
 * time somebody adds a table — the delete is attempted inside a transaction and
 * Postgres's own refusal is caught and reported, naming the table that still
 * points at the row. Nothing is ever orphaned to make a delete succeed.
 */

export type PurgeKind = BinKind;

export class PurgeRefused extends Error {
  constructor(
    readonly reason: "notInBin" | "hasIssuedDocuments" | "personIsOnSite" | "stillReferenced",
    /** The table still pointing at it, for `stillReferenced`. */
    readonly by?: string,
  ) {
    super(reason);
    this.name = "PurgeRefused";
  }
}

/**
 * Whether this row could be destroyed, asked before the button is drawn.
 *
 * The same rule the purge enforces, so the screen and the action cannot
 * disagree — the pattern screen 22's greyed buttons already follow. What it
 * CANNOT know in advance is the foreign-key answer: that is the database's to
 * give, and asking it would mean running the delete. So a row may look
 * purgeable here and still be refused, with the table named.
 */
export async function purgeBlockedBy(
  kind: PurgeKind,
  id: string,
): Promise<PurgeRefused["reason"] | null> {
  if (kind === "company") {
    const [row] = await db
      .select({ deletedAt: party.deletedAt })
      .from(party)
      .where(eq(party.id, id))
      .limit(1);
    if (!row?.deletedAt) return "notInBin";
    return (await issuedDocumentCount(id)) > 0 ? "hasIssuedDocuments" : null;
  }

  if (kind === "deal") {
    const [row] = await db
      .select({ deletedAt: deal.deletedAt })
      .from(deal)
      .where(eq(deal.id, id))
      .limit(1);
    if (!row?.deletedAt) return "notInBin";
    return (await issuedDocumentCountForDeal(id)) > 0 ? "hasIssuedDocuments" : null;
  }

  if (kind === "document") {
    const [row] = await db
      .select({
        number: document.number,
        lockedAt: document.lockedAt,
        deletedAt: document.deletedAt,
      })
      .from(document)
      .where(eq(document.id, id))
      .limit(1);
    if (!row?.deletedAt) return "notInBin";
    // Belt and braces: a numbered row can never reach the bin, and if one ever
    // does the answer is still no.
    return row.number !== null || row.lockedAt !== null ? "hasIssuedDocuments" : null;
  }

  if (kind === "person") {
    const [row] = await db
      .select({ deletedAt: person.deletedAt })
      .from(person)
      .where(eq(person.id, id))
      .limit(1);
    if (!row?.deletedAt) return "notInBin";
    const [crew] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(projectCrew)
      .where(and(eq(projectCrew.personId, id), isNull(projectCrew.leftOn)));
    return (crew?.n ?? 0) > 0 ? "personIsOnSite" : null;
  }

  const [row] = await db
    .select({ deletedAt: note.deletedAt })
    .from(note)
    .where(eq(note.id, id))
    .limit(1);
  return row?.deletedAt ? null : "notInBin";
}

/** Postgres's own answer, turned into the name of the table that refused. */
function referencedBy(error: unknown): string | null {
  const e = error as { code?: string; table_name?: string; table?: string; detail?: string };
  if (e?.code !== "23503") return null;
  // `detail` reads: is still referenced from table "document".
  const named = e.detail?.match(/table "([^"]+)"/)?.[1];
  return named ?? e.table_name ?? e.table ?? "unknown";
}

/**
 * Destroy one row in the bin. There is no undo after this and the screen says so.
 *
 * A DEAL takes its own still-binned drafts with it, in the same transaction and
 * with an audit entry each: `document.deal_id` is ON DELETE NO ACTION, so the
 * alternative is refusing every deal whose drafts went into the bin alongside
 * it — which is every deal V1 ever binned. A draft somebody restored on its own
 * is live, and then the delete is refused and says which table held it.
 */
export async function purgeFromBin(opts: {
  kind: PurgeKind;
  id: string;
  actorId: string;
}): Promise<void> {
  const blocked = await purgeBlockedBy(opts.kind, opts.id);
  if (blocked) throw new PurgeRefused(blocked);

  try {
    await db.transaction(async (tx) => {
      // The entry first, and in the same transaction: if the delete fails the
      // entry rolls back with it, and if it succeeds the entry is already there.
      // An audit trail written after the fact is one that can be missing.
      const write = (entity: string, entityId: string, before: Record<string, unknown>) =>
        tx.insert(auditEntry).values({
          actorId: opts.actorId,
          actorKind: "user",
          entity,
          entityId,
          action: "purge",
          before,
          sourceScreen: "83",
        });

      if (opts.kind === "company") {
        const [row] = await tx.select().from(party).where(eq(party.id, opts.id)).limit(1);
        await write("party", opts.id, { code: row?.code, legalName: row?.legalName });
        await tx.delete(party).where(eq(party.id, opts.id));
        return;
      }

      if (opts.kind === "deal") {
        const [row] = await tx.select().from(deal).where(eq(deal.id, opts.id)).limit(1);
        const drafts = await tx
          .select({ id: document.id, kind: document.kind })
          .from(document)
          .where(and(eq(document.dealId, opts.id), isNotNull(document.deletedAt)));

        for (const draft of drafts) {
          await write("document", draft.id, { kind: draft.kind, number: null, withDeal: row?.ref });
          await tx.delete(document).where(eq(document.id, draft.id));
        }

        await write("deal", opts.id, {
          ref: row?.ref,
          subject: row?.subject,
          drafts: drafts.length,
        });
        await tx.delete(deal).where(eq(deal.id, opts.id));
        return;
      }

      if (opts.kind === "document") {
        const [row] = await tx.select().from(document).where(eq(document.id, opts.id)).limit(1);
        await write("document", opts.id, { kind: row?.kind, number: null });
        await tx.delete(document).where(eq(document.id, opts.id));
        return;
      }

      if (opts.kind === "person") {
        const [row] = await tx.select().from(person).where(eq(person.id, opts.id)).limit(1);
        await write("person", opts.id, { fullName: row?.fullName, trade: row?.trade });
        await tx.delete(person).where(eq(person.id, opts.id));
        return;
      }

      const [row] = await tx.select().from(note).where(eq(note.id, opts.id)).limit(1);
      await write("note", opts.id, {
        about: row ? `${row.entity}:${row.entityId}` : null,
        said: row?.body.slice(0, 200),
      });
      await tx.delete(note).where(eq(note.id, opts.id));
    });
  } catch (error) {
    const table = referencedBy(error);
    if (table) throw new PurgeRefused("stillReferenced", table);
    throw error;
  }
}
