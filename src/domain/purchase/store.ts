import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine } from "@/db/schema/deal";
import { deliveryDetail } from "@/db/schema/delivery";
import { document, documentLine, documentLink } from "@/db/schema/document";
import { payment, paymentAllocation } from "@/db/schema/money";
import { party } from "@/db/schema/party";
import { sourcingLine, sourcingRequest, sourcingResponse } from "@/db/schema/sourcing";
import { computeTotals, lineTotalExcl } from "@/domain/money";
import { isInstrument } from "@/domain/money/instruments";

/**
 * Screen 68 — the WRITES.
 *
 * `order.ts` next door reads a purchase order back with its receipts, its
 * supplier invoices and the three-way match, and it was written first — so
 * for a while the buy side could be looked at and not driven. The first walk
 * of one purchase from the supplier's answer to the supplier being paid found
 * that nothing here existed: no way to place the order from the price the
 * supplier gave, none to say the goods arrived, none to record their facture,
 * and `recordPayment` refused a supplier invoice as "no such invoice".
 *
 * Same rules as the sell side. Everything is a DRAFT until a person issues it
 * on screen 18 (LAW 2, LAW 5); every line points at the order line it fulfils
 * or bills (`source_line_id`), which is what makes the match in `match.ts`
 * arithmetic rather than guesswork; and the supplier's own numbers are kept
 * verbatim, because they are what the supplier will quote on the phone.
 */

export class CannotBuy extends Error {
  constructor(
    readonly why:
      | "noSuchAnswer"
      | "notQuoted"
      | "requestNotSent"
      | "nothingPriced"
      | "noSuchOrder"
      | "orderNotIssued"
      | "nothingToReceive"
      | "nothingToBill"
      | "lineNotOnOrder"
      | "theirNumberRequired",
  ) {
    super(why);
  }
}

/**
 * Place the order with the supplier who answered.
 *
 * The lines and the prices come from THEIR answer on the sourcing request —
 * the same rows screen 67 compared and screen 12 costed the offer from. A
 * purchase order typed from memory a week later is how the cost on the offer
 * and the price on the order come to disagree.
 *
 * Lines the supplier left unpriced are not ordered from them. `lineIds`
 * narrows further, for the case where two suppliers split an enquiry.
 */
export async function orderFromAnswer(opts: {
  responseId: string;
  lineIds?: string[];
  /** When they said it would be here, as a date; else today + their lead time. */
  expectedOn?: string | null;
  actorId: string;
}): Promise<string> {
  const [answer] = await db
    .select({
      id: sourcingResponse.id,
      status: sourcingResponse.status,
      partyId: sourcingResponse.partyId,
      currency: sourcingResponse.currency,
      leadTimeDays: sourcingResponse.leadTimeDays,
      requestId: sourcingResponse.requestId,
      dealId: sourcingRequest.dealId,
      sentAt: sourcingRequest.sentAt,
    })
    .from(sourcingResponse)
    .innerJoin(sourcingRequest, eq(sourcingRequest.id, sourcingResponse.requestId))
    .where(eq(sourcingResponse.id, opts.responseId))
    .limit(1);
  if (!answer) throw new CannotBuy("noSuchAnswer");
  if (!answer.sentAt) throw new CannotBuy("requestNotSent");
  if (answer.status !== "quoted") throw new CannotBuy("notQuoted");

  const [supplier] = await db
    .select({ docLocale: party.docLocale })
    .from(party)
    .where(eq(party.id, answer.partyId))
    .limit(1);

  const priced = await db
    .select({
      dealLineId: sourcingLine.dealLineId,
      unitPrice: sourcingLine.unitPrice,
      theirReference: sourcingLine.theirReference,
      theirDesignation: sourcingLine.theirDesignation,
      position: dealLine.position,
      reference: dealLine.reference,
      designation: dealLine.designation,
      qty: dealLine.qty,
      unit: dealLine.unit,
      itemId: dealLine.itemId,
    })
    .from(sourcingLine)
    .innerJoin(dealLine, eq(dealLine.id, sourcingLine.dealLineId))
    .where(
      and(
        eq(sourcingLine.responseId, opts.responseId),
        sql`${sourcingLine.unitPrice} is not null`,
        opts.lineIds ? inArray(sourcingLine.dealLineId, opts.lineIds) : sql`true`,
      ),
    )
    .orderBy(asc(dealLine.position));
  if (priced.length === 0) throw new CannotBuy("nothingPriced");

  const priceable = priced.map((line) => ({
    qty: line.qty,
    unitPrice: line.unitPrice ?? "0",
    discountPct: "0",
    vatRate: "19",
  }));
  const totals = computeTotals(priceable);

  const today = new Date();
  const expectedOn =
    opts.expectedOn ||
    (answer.leadTimeDays
      ? new Date(today.getTime() + answer.leadTimeDays * 86_400_000).toISOString().slice(0, 10)
      : null);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(document)
      .values({
        kind: "purchase_order",
        number: null,
        partyId: answer.partyId,
        dealId: answer.dealId,
        // LAW 4 — the order speaks the supplier's language.
        locale: supplier?.docLocale ?? "fr",
        currency: answer.currency,
        issuedOn: today.toISOString().slice(0, 10),
        dueOn: expectedOn,
        status: "draft",
        totals,
      })
      .returning({ id: document.id });
    const id = created?.id as string;

    await tx.insert(documentLine).values(
      priced.map((line, index) => ({
        documentId: id,
        position: index + 1,
        lineKind: "item",
        dealLineId: line.dealLineId,
        itemId: line.itemId,
        // Their reference first, ours as a fallback: the order is read by them.
        reference: line.theirReference ?? line.reference,
        designation: line.designation,
        note:
          line.theirDesignation && line.theirDesignation !== line.designation
            ? line.theirDesignation
            : null,
        unit: line.unit,
        qty: line.qty,
        unitPrice: line.unitPrice,
        vatRate: "19",
        totalExcl: lineTotalExcl({ qty: line.qty, unitPrice: line.unitPrice ?? "0" }).toFixed(2),
      })),
    );

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "document",
      entityId: id,
      action: "create",
      after: {
        kind: "purchase_order",
        fromAnswer: opts.responseId,
        supplier: answer.partyId,
        lines: priced.length,
        number: null,
        numberReserved: false,
      },
      sourceScreen: "67",
    });

    return id;
  });
}

async function issuedOrder(orderId: string) {
  const [order] = await db.select().from(document).where(eq(document.id, orderId)).limit(1);
  if (order?.kind !== "purchase_order") throw new CannotBuy("noSuchOrder");
  // Receiving against a draft is receiving against something nobody sent.
  if (order.status !== "issued") throw new CannotBuy("orderNotIssued");
  return order;
}

/** The order's item lines, keyed by id, so a child line can only point at one. */
async function orderLines(orderId: string) {
  const rows = await db
    .select()
    .from(documentLine)
    .where(and(eq(documentLine.documentId, orderId), eq(documentLine.lineKind, "item")))
    .orderBy(asc(documentLine.position));
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * The goods arrived.
 *
 * A `goods_receipt` is the supplier's bon de livraison as WE saw it: what came,
 * who took it in, what was wrong with it — written in the same
 * `delivery_detail` row screen 49 uses for our own BLs, because a delivery is
 * a delivery whichever way the lorry is pointing. It carries no money; the
 * price is the order's business and the invoice's.
 */
export async function receiveGoods(opts: {
  orderId: string;
  /** order line id → quantity that arrived on this receipt. */
  quantities: Record<string, string>;
  receivedOn: string;
  /** The supplier's own BL number, verbatim. */
  supplierRef?: string | null;
  receivedBy?: string | null;
  /** "Conforme", or what was wrong. Verbatim. */
  reserves?: string | null;
  actorId: string;
}): Promise<string> {
  const order = await issuedOrder(opts.orderId);
  const lines = await orderLines(opts.orderId);

  const wanted = Object.entries(opts.quantities).filter(([, qty]) => Number(qty) > 0);
  if (wanted.length === 0) throw new CannotBuy("nothingToReceive");
  if (wanted.some(([lineId]) => !lines.has(lineId))) throw new CannotBuy("lineNotOnOrder");

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(document)
      .values({
        kind: "goods_receipt",
        number: null,
        partyId: order.partyId,
        dealId: order.dealId,
        locale: order.locale,
        currency: order.currency,
        issuedOn: opts.receivedOn,
        status: "draft",
        // No money on a receipt. See the note on `startDelivery`.
        totals: {},
      })
      .returning({ id: document.id });
    const id = created?.id as string;

    await tx.insert(documentLine).values(
      wanted.map(([lineId, qty], index) => {
        const source = lines.get(lineId);
        return {
          documentId: id,
          position: index + 1,
          lineKind: "item",
          sourceLineId: lineId,
          itemId: source?.itemId ?? null,
          reference: source?.reference ?? null,
          designation: source?.designation ?? null,
          unit: source?.unit ?? null,
          qty,
        };
      }),
    );

    // Order → receipt, the direction `purchaseOrder()` reads.
    await tx
      .insert(documentLink)
      .values({ fromDocument: opts.orderId, toDocument: id, relation: "fulfils" });

    await tx.insert(deliveryDetail).values({
      documentId: id,
      counterpartyRef: opts.supplierRef?.trim() || null,
      receivedBy: opts.receivedBy?.trim() || null,
      receivedOn: opts.receivedOn,
      reserves: opts.reserves?.trim() || null,
    });

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "document",
      entityId: id,
      action: "create",
      after: {
        kind: "goods_receipt",
        against: opts.orderId,
        orderNumber: order.number,
        supplierRef: opts.supplierRef ?? null,
        lines: wanted.length,
        number: null,
        numberReserved: false,
      },
      sourceScreen: "68",
    });

    return id;
  });
}

/**
 * The supplier's facture, recorded against the order.
 *
 * Their number is the document's number — screen 50 numbers this kind by
 * `clientReference`, and the partial unique index on our own numbers leaves it
 * out, because two suppliers may both send a "F-0001". The quantity and the
 * price on each line are what THEY billed, which is the whole point: the
 * three-way match compares them with what was ordered and what arrived, and
 * `held` on screen 68 is the difference nobody has explained.
 */
export async function recordSupplierInvoice(opts: {
  orderId: string;
  /** The supplier's invoice number, verbatim. Required — it is their claim. */
  theirNumber: string;
  invoiceDate: string;
  dueDate?: string | null;
  /** order line id → what they billed for it. */
  lines: Record<string, { qty: string; unitPrice: string }>;
  /** virement | cheque | especes | traite | compensation, when they said. */
  settlement?: string | null;
  actorId: string;
}): Promise<string> {
  const order = await issuedOrder(opts.orderId);
  const ordered = await orderLines(opts.orderId);

  const theirNumber = opts.theirNumber.trim();
  if (!theirNumber) throw new CannotBuy("theirNumberRequired");

  const billed = Object.entries(opts.lines).filter(([, line]) => Number(line.qty) > 0);
  if (billed.length === 0) throw new CannotBuy("nothingToBill");
  if (billed.some(([lineId]) => !ordered.has(lineId))) throw new CannotBuy("lineNotOnOrder");

  const priceable = billed.map(([lineId, line]) => ({
    qty: line.qty,
    unitPrice: line.unitPrice,
    discountPct: "0",
    vatRate: ordered.get(lineId)?.vatRate ?? "19",
  }));
  const totals = computeTotals(priceable);
  const settlement =
    opts.settlement && isInstrument(opts.settlement) ? opts.settlement : order.settlement;

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(document)
      .values({
        kind: "supplier_invoice",
        number: theirNumber,
        partyId: order.partyId,
        dealId: order.dealId,
        locale: order.locale,
        currency: order.currency,
        issuedOn: opts.invoiceDate,
        dueOn: opts.dueDate ?? null,
        status: "draft",
        settlement,
        totals,
      })
      .returning({ id: document.id });
    const id = created?.id as string;

    await tx.insert(documentLine).values(
      billed.map(([lineId, line], index) => {
        const source = ordered.get(lineId);
        return {
          documentId: id,
          position: index + 1,
          lineKind: "item",
          sourceLineId: lineId,
          itemId: source?.itemId ?? null,
          reference: source?.reference ?? null,
          designation: source?.designation ?? null,
          unit: source?.unit ?? null,
          qty: line.qty,
          unitPrice: line.unitPrice,
          vatRate: source?.vatRate ?? "19",
          totalExcl: lineTotalExcl({ qty: line.qty, unitPrice: line.unitPrice }).toFixed(2),
        };
      }),
    );

    await tx
      .insert(documentLink)
      .values({ fromDocument: opts.orderId, toDocument: id, relation: "bills" });

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "document",
      entityId: id,
      action: "create",
      after: {
        kind: "supplier_invoice",
        against: opts.orderId,
        orderNumber: order.number,
        theirNumber,
        lines: billed.length,
        totalIncl: totals.totalIncl,
      },
      sourceScreen: "68",
    });

    return id;
  });
}

export type Payable = {
  documentId: string;
  number: string | null;
  partyId: string;
  supplierName: string;
  issuedOn: Date | null;
  dueOn: Date | null;
  totalIncl: string;
  paid: string;
  currency: string;
};

/**
 * What we owe suppliers: every RECORDED supplier invoice with what has left
 * the bank against it. The mirror of `owings()`, and read by `recordPayment`
 * when the money goes out rather than in.
 */
export async function payables(opts: { partyId?: string } = {}): Promise<Payable[]> {
  const rows = await db
    .select({
      documentId: document.id,
      number: document.number,
      partyId: document.partyId,
      supplierName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      issuedOn: document.issuedOn,
      dueOn: document.dueOn,
      totals: document.totals,
      currency: document.currency,
      paid: sql<string>`coalesce((
        select sum(${paymentAllocation.amount})
        from ${paymentAllocation}
        join ${payment} on ${payment.id} = ${paymentAllocation.paymentId}
        where ${paymentAllocation.documentId} = ${document.id}
          and ${payment.deletedAt} is null
      ), 0)::text`,
    })
    .from(document)
    .innerJoin(party, eq(party.id, document.partyId))
    .where(
      and(
        eq(document.kind, "supplier_invoice"),
        // Recorded, under their number. A draft is a facture somebody has not
        // read yet, and nothing is owed on it.
        eq(document.status, "issued"),
        opts.partyId ? eq(document.partyId, opts.partyId) : sql`true`,
      ),
    );

  return rows.map((row) => {
    const totals = (row.totals ?? {}) as { totalIncl?: string };
    return {
      documentId: row.documentId,
      number: row.number,
      partyId: row.partyId,
      supplierName: row.supplierName,
      issuedOn: row.issuedOn ? new Date(`${row.issuedOn}T00:00:00Z`) : null,
      dueOn: row.dueOn ? new Date(`${row.dueOn}T00:00:00Z`) : null,
      totalIncl: totals.totalIncl ?? "0",
      paid: row.paid,
      currency: row.currency,
    };
  });
}

/** Which enquiry an order answers, for the audit line and the page header. */
export async function dealRefOf(dealId: string | null): Promise<string | null> {
  if (!dealId) return null;
  const [row] = await db.select({ ref: deal.ref }).from(deal).where(eq(deal.id, dealId)).limit(1);
  return row?.ref ?? null;
}
