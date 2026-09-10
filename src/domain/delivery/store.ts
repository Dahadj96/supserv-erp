import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deliveryDetail } from "@/db/schema/delivery";
import { document, documentLine, documentLink } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import { liveDocument } from "@/domain/deletion";
import { DELIVERABLE_KINDS, type DeliveredLine, mayDeliverAgainst, type SourceLine } from "./lines";

/**
 * Screens 49 and 14 — the database half.
 *
 * A bon de livraison is a document of kind `delivery_note`, through the same
 * engine and the same numbering series as everything else (LAW 3). What it
 * covers is `document_link` with relation `covers`, which is the link the
 * screen 49 banner promises is kept both ways:
 *
 *   "A delivery note can be issued without an invoice, and one invoice can
 *    cover several delivery notes."
 */

export class CannotDeliver extends Error {
  constructor(
    readonly why:
      | "noSuchDocument"
      | "sourceNotDeliverable"
      | "sourceNotIssued"
      | "nothingToDeliver"
      | "quantityNotPositive"
      | "alreadySigned",
  ) {
    super(why);
  }
}

/** The lines of the document being delivered against — the order or the offer. */
export async function sourceLines(documentId: string): Promise<SourceLine[]> {
  const rows = await db
    .select({
      lineId: documentLine.id,
      position: documentLine.position,
      designation: documentLine.designation,
      unit: documentLine.unit,
      qty: documentLine.qty,
    })
    .from(documentLine)
    .where(and(eq(documentLine.documentId, documentId), eq(documentLine.lineKind, "item")))
    .orderBy(asc(documentLine.position));

  return rows.map((row) => ({ ...row, qty: row.qty ?? "0" }));
}

/**
 * Every BL line anywhere that delivers one of these source lines, with whether
 * its own document has been issued.
 *
 * `issued` travels with the line rather than being filtered here, because
 * screen 49 needs both answers: what has GONE (issued only) and what is
 * PLANNED across the drafts. Filtering at the query would make the second
 * unavailable without a second query.
 */
export async function coveredAgainst(
  sourceLineIds: string[],
  /**
   * Which kind of document counts as covering. `delivery_note` answers "what
   * has gone out"; `invoice` answers "what has been billed", which screen 72
   * asks with the same arithmetic — one proforma becomes several factures as
   * the lorries leave, and "already invoiced 4 of 9" is the same subtraction as
   * "already delivered 12 of 24".
   */
  kinds: string[] = ["delivery_note"],
): Promise<DeliveredLine[]> {
  if (sourceLineIds.length === 0) return [];

  const rows = await db
    .select({
      sourceLineId: documentLine.sourceLineId,
      qty: documentLine.qty,
      number: document.number,
    })
    .from(documentLine)
    .innerJoin(document, eq(document.id, documentLine.documentId))
    .where(
      and(
        inArray(documentLine.sourceLineId, sourceLineIds),
        inArray(document.kind, kinds),
        // A cancelled document covered nothing.
        sql`${document.status} <> 'credited'`,
      ),
    );

  return rows.map((row) => ({
    sourceLineId: row.sourceLineId,
    qty: row.qty ?? "0",
    // LAW 5 — the number IS the issue. A BL with no number is a lorry that has
    // not left, and counting it would let somebody invoice goods still in the
    // warehouse.
    issued: row.number !== null,
  }));
}

/** The lines of one BL. */
export async function deliveryLines(documentId: string): Promise<DeliveredLine[]> {
  const rows = await db
    .select({ sourceLineId: documentLine.sourceLineId, qty: documentLine.qty })
    .from(documentLine)
    .where(and(eq(documentLine.documentId, documentId), eq(documentLine.lineKind, "item")));

  return rows.map((row) => ({
    sourceLineId: row.sourceLineId,
    qty: row.qty ?? "0",
    issued: false,
  }));
}

/**
 * The link, both ways, as the screen 49 banner promises.
 *
 * Named for the question rather than for the column, because `coveredBy` and
 * `covers` differ by one word and by the direction of a join, and reading the
 * wrong one gives an empty array rather than an error — the failure mode is a
 * screen that quietly says a delivery note is linked to nothing.
 */

/** The order or offer this bon de livraison delivers against. */
export async function sourceOf(deliveryNoteId: string) {
  return db
    .select({ id: document.id, kind: document.kind, number: document.number })
    .from(documentLink)
    .innerJoin(document, eq(document.id, documentLink.toDocument))
    .where(and(eq(documentLink.fromDocument, deliveryNoteId), eq(documentLink.relation, "covers")));
}

/** Every bon de livraison raised against this order or offer. */
export async function deliveryNotesFor(sourceId: string) {
  return db
    .select({ id: document.id, kind: document.kind, number: document.number })
    .from(documentLink)
    .innerJoin(document, eq(document.id, documentLink.fromDocument))
    .where(and(eq(documentLink.toDocument, sourceId), eq(documentLink.relation, "covers")));
}

export type DeliveryDetail = typeof deliveryDetail.$inferSelect;

export async function detailFor(documentId: string): Promise<DeliveryDetail | null> {
  const [row] = await db
    .select()
    .from(deliveryDetail)
    .where(eq(deliveryDetail.documentId, documentId))
    .limit(1);
  return row ?? null;
}

/**
 * Start a bon de livraison against a source document.
 *
 * Creates a DRAFT with no number, exactly as screen 48's conversion does and
 * for the same reason: the number is reserved inside the transaction that
 * issues it, so the register stays gapless.
 */
export async function startDelivery(opts: {
  /** The order, offer or proforma whose lines are being delivered. */
  sourceId: string;
  /** sourceLineId → quantity going out on this BL. */
  quantities: Record<string, string>;
  deliverOn: string;
  actorId: string;
}): Promise<string> {
  const [source] = await db.select().from(document).where(eq(document.id, opts.sourceId)).limit(1);
  if (!source) throw new CannotDeliver("noSuchDocument");
  // The KIND, and not only the state. A bon de livraison against a bon de
  // livraison was reachable by typing an id: the button was hidden on the
  // document screen and nothing behind it asked.
  if (!mayDeliverAgainst(source.kind)) throw new CannotDeliver("sourceNotDeliverable");
  // Delivering against a draft means delivering against something the client
  // has never agreed to. The STATE, not the number: a client's own order is
  // issued under their reference and may carry no number of ours at all.
  if (source.status !== "issued") throw new CannotDeliver("sourceNotIssued");

  const wanted = Object.entries(opts.quantities).filter(([, qty]) => Number(qty) > 0);
  if (wanted.length === 0) throw new CannotDeliver("nothingToDeliver");

  const lines = await db
    .select()
    .from(documentLine)
    .where(
      inArray(
        documentLine.id,
        wanted.map(([lineId]) => lineId),
      ),
    );

  if (lines.length !== wanted.length) throw new CannotDeliver("nothingToDeliver");

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(document)
      .values({
        kind: "delivery_note",
        number: null,
        partyId: source.partyId,
        dealId: source.dealId,
        locale: source.locale,
        currency: source.currency,
        issuedOn: opts.deliverOn,
        status: "draft",
        // A BL carries no money. It proves that goods moved; what they cost is
        // the facture's business, and printing a total here invites somebody to
        // treat a delivery note as a bill.
        totals: {},
      })
      .returning({ id: document.id });

    const id = created?.id as string;

    await tx.insert(documentLine).values(
      wanted.map(([sourceLineId, qty], index) => {
        const source = lines.find((line) => line.id === sourceLineId);
        return {
          documentId: id,
          position: index + 1,
          lineKind: "item",
          sourceLineId,
          itemId: source?.itemId ?? null,
          reference: source?.reference ?? null,
          designation: source?.designation ?? null,
          designationSource: source?.designationSource ?? null,
          unit: source?.unit ?? null,
          qty,
          // Deliberately no price. See the note on `totals` above.
        };
      }),
    );

    await tx
      .insert(documentLink)
      .values({ fromDocument: id, toDocument: opts.sourceId, relation: "covers" });

    await tx.insert(deliveryDetail).values({ documentId: id });

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "document",
      entityId: id,
      action: "create",
      after: {
        kind: "delivery_note",
        covers: opts.sourceId,
        sourceNumber: source.number,
        lines: wanted.length,
        number: null,
        numberReserved: false,
      },
      sourceScreen: "49",
    });

    return id;
  });
}

/** Packing, transport and destination. Editable while the BL is a draft. */
export async function saveDetail(opts: {
  documentId: string;
  patch: Partial<Omit<DeliveryDetail, "documentId">>;
  actorId: string;
}): Promise<void> {
  await db
    .insert(deliveryDetail)
    .values({ documentId: opts.documentId, ...opts.patch })
    .onConflictDoUpdate({ target: deliveryDetail.documentId, set: opts.patch });

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "delivery_detail",
    entityId: opts.documentId,
    action: "update",
    after: opts.patch as Record<string, unknown>,
    sourceScreen: "49",
  });
}

/**
 * Record that the signed copy has come back.
 *
 * A separate act from delivering, and the one screen 14's amber banner is
 * about: "Delivery BL-2026-0118 has no signed proof attached. Without it we
 * cannot answer a delivery dispute."
 *
 * It is a date, not a flag, so "when did it come back" is answerable, and it
 * is written once — a second signing is somebody overwriting the record of the
 * first, which in a dispute is the record that matters.
 */
export async function recordSignedCopy(opts: {
  documentId: string;
  receivedBy: string;
  receivedOn: string | null;
  reserves: string | null;
  actorId: string;
}): Promise<void> {
  const existing = await detailFor(opts.documentId);
  if (existing?.signedCopyOnFile) throw new CannotDeliver("alreadySigned");

  await saveDetail({
    documentId: opts.documentId,
    patch: {
      receivedBy: opts.receivedBy.trim() || null,
      receivedOn: opts.receivedOn,
      // Verbatim. A tidied reserve is evidence of nothing.
      reserves: opts.reserves?.trim() || null,
      signedCopyOnFile: new Date(),
      signedCopyBy: opts.actorId,
    },
    actorId: opts.actorId,
  });
}

/**
 * What a new bon de livraison can be started FROM — screen 49, step zero.
 *
 * `/deliveries/new` used to demand `?source=<id>` in the query string and call
 * `notFound()` when it was absent, so the primary button on screen 14 — which
 * links at the bare route, because from a list of deliveries there is no one
 * order to name — landed on a 404. The page was never missing. The question it
 * needed answering first was.
 *
 * So it asks it. Every issued document a delivery may be raised against
 * (`DELIVERABLE_KINDS`), live, with what it ordered and what has already gone,
 * so the choice is made against the arithmetic rather than against a number
 * somebody has to recognise.
 *
 * `openOnly` is the default because a fully delivered order is not what anybody
 * is looking for when they press "New delivery"; it stays reachable through
 * `openOnly: false` rather than disappearing, since an over-delivery and a
 * replacement both start from an order that already reads complete.
 */
export type DeliverySource = {
  documentId: string;
  kind: string;
  number: string | null;
  clientName: string;
  partyId: string;
  issuedOn: Date | null;
  lines: number;
  /** Sum of the item quantities on the source. */
  ordered: string;
  /** Sum of the quantities on the ISSUED delivery notes that cover it. */
  delivered: string;
  /** Ordered less delivered, never negative. Zero means nothing is owed. */
  remaining: string;
};

export async function deliverableSources(
  opts: { openOnly?: boolean; partyId?: string } = {},
): Promise<DeliverySource[]> {
  const openOnly = opts.openOnly ?? true;

  const rows = await db
    .select({
      documentId: document.id,
      kind: document.kind,
      number: document.number,
      partyId: document.partyId,
      issuedOn: document.issuedOn,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      lines: sql<number>`(
        select count(*) from document_line dl
        where dl.document_id = ${document.id} and dl.line_kind = 'item'
      )::int`,
      ordered: sql<string>`coalesce((
        select sum(dl.qty) from document_line dl
        where dl.document_id = ${document.id} and dl.line_kind = 'item'
      ), 0)::text`,
      // ISSUED delivery notes only, and never a cancelled one — the same two
      // clauses `coveredAgainst` applies, for the same reason: a draft BL is a
      // lorry that has not left.
      delivered: sql<string>`coalesce((
        select sum(bl.qty)
        from document_line bl
        join document b on b.id = bl.document_id
        join document_line src on src.id = bl.source_line_id
        where src.document_id = ${document.id}
          and b.kind = 'delivery_note'
          and b.number is not null
          and b.status <> 'credited'
          and b.deleted_at is null
      ), 0)::text`,
    })
    .from(document)
    .innerJoin(party, eq(party.id, document.partyId))
    .where(
      and(
        inArray(document.kind, [...DELIVERABLE_KINDS]),
        // The STATE, not the number: a client's own bon de commande is issued
        // under their reference and carries no number of ours. `startDelivery`
        // asks exactly this, so the selector cannot offer what the action
        // would refuse.
        eq(document.status, "issued"),
        liveDocument,
        opts.partyId ? eq(document.partyId, opts.partyId) : sql`true`,
      ),
    )
    .orderBy(desc(document.issuedOn), desc(document.createdAt));

  const mapped = rows.map((row) => {
    const ordered = new Decimal(row.ordered || "0");
    const delivered = new Decimal(row.delivered || "0");
    const left = ordered.minus(delivered);
    return {
      documentId: row.documentId,
      kind: row.kind,
      number: row.number,
      clientName: row.clientName,
      partyId: row.partyId,
      issuedOn: row.issuedOn ? new Date(`${row.issuedOn}T00:00:00Z`) : null,
      lines: row.lines,
      ordered: ordered.toDecimalPlaces(4).toFixed(),
      delivered: delivered.toDecimalPlaces(4).toFixed(),
      remaining: (left.isNegative() ? new Decimal(0) : left).toDecimalPlaces(4).toFixed(),
    };
  });

  // A source with no item lines has nothing to carry forward, so offering it
  // would open a form with an empty table and no way to explain itself.
  const withLines = mapped.filter((row) => row.lines > 0);

  return openOnly ? withLines.filter((row) => Number(row.remaining) > 0) : withLines;
}

export type DeliveryRow = {
  documentId: string;
  number: string | null;
  status: string;
  issuedOn: Date | null;
  clientName: string;
  partyId: string;
  lines: number;
  signedCopyOnFile: Date | null;
  receivedBy: string | null;
  /** The document this BL covers, when it covers one. */
  coversNumber: string | null;
  coversId: string | null;
};

/** Screen 14's list. */
export async function deliveries(opts: { sourceId?: string } = {}): Promise<DeliveryRow[]> {
  const rows = await db
    .select({
      documentId: document.id,
      number: document.number,
      status: document.status,
      issuedOn: document.issuedOn,
      partyId: document.partyId,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      signedCopyOnFile: deliveryDetail.signedCopyOnFile,
      receivedBy: deliveryDetail.receivedBy,
      coversId: documentLink.toDocument,
      lines: sql<number>`(
        select count(*) from document_line dl
        where dl.document_id = ${document.id} and dl.line_kind = 'item'
      )::int`,
    })
    .from(document)
    .innerJoin(party, eq(party.id, document.partyId))
    .leftJoin(deliveryDetail, eq(deliveryDetail.documentId, document.id))
    .leftJoin(
      documentLink,
      and(eq(documentLink.fromDocument, document.id), eq(documentLink.relation, "covers")),
    )
    .where(
      and(
        eq(document.kind, "delivery_note"),
        opts.sourceId ? eq(documentLink.toDocument, opts.sourceId) : sql`true`,
      ),
    )
    .orderBy(desc(document.issuedOn), desc(document.createdAt));

  const coversIds = rows.map((row) => row.coversId).filter((id): id is string => id !== null);
  const sources =
    coversIds.length === 0
      ? []
      : await db
          .select({ id: document.id, number: document.number })
          .from(document)
          .where(and(inArray(document.id, coversIds), isNotNull(document.number)));

  return rows.map((row) => ({
    documentId: row.documentId,
    number: row.number,
    status: row.status,
    issuedOn: row.issuedOn ? new Date(`${row.issuedOn}T00:00:00Z`) : null,
    clientName: row.clientName,
    partyId: row.partyId,
    lines: row.lines,
    signedCopyOnFile: row.signedCopyOnFile,
    receivedBy: row.receivedBy,
    coversId: row.coversId,
    coversNumber: sources.find((s) => s.id === row.coversId)?.number ?? null,
  }));
}
