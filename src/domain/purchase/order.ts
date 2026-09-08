import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { deal } from "@/db/schema/deal";
import { deliveryDetail } from "@/db/schema/delivery";
import { document, documentLine, documentLink } from "@/db/schema/document";
import { paymentAllocation } from "@/db/schema/money";
import { party } from "@/db/schema/party";
import { type MatchLine, safeToPayNow, type ThreeWayMatch, threeWayMatch } from "./match";

/**
 * Screen 68 — Supplier order.
 *
 * The leg that was missing. Screens 09 and 67 ask suppliers for prices; screen
 * 12 puts those prices on an offer; screen 13 lists the order once it is
 * placed. Between the order and the invoice there was nothing, which means the
 * client delivery date was a guess and the margin was whatever the supplier
 * decided to invoice.
 *
 * NO NEW TABLES. A purchase order is a `document` of kind `purchase_order`, a
 * goods receipt is one of kind `goods_receipt`, and a supplier invoice is one
 * of kind `supplier_invoice`. They are joined by `document_link` and their
 * lines by `document_line.source_line_id` — the same column screen 49 uses to
 * add three delivery notes up against one order. LAW 3 is not a slogan about
 * PDFs; it is why this screen needed no schema at all.
 *
 * Matching lines by `source_line_id` rather than by designation is the whole
 * reliability of the three-way match. Two lines that read the same - "Joint
 * EPDM DN80" ordered twice at different prices - would collapse into one, and
 * the screen would report a price difference on an order where nothing is
 * wrong.
 */

export type ReceiptRow = {
  id: string;
  number: string | null;
  receivedOn: string | null;
  /** The supplier's own delivery note reference, kept verbatim. */
  supplierRef: string | null;
  receivedBy: string | null;
  /** What was written in the reserves box. "Conforme", or what was wrong. */
  condition: string | null;
  lines: number;
  status: string;
};

export type Money = {
  currency: string;
  /** What the order committed to. */
  ordered: string;
  /** What the supplier has billed against it so far. */
  invoiced: string;
  /** What has actually left the bank against those invoices. */
  paid: string;
  /** Asked above what was agreed, and unexplained. */
  held: string;
  /** invoiced − paid − held, never below zero. */
  safeToPay: string;
  /**
   * The supplier's terms, VERBATIM from their record. Screen 68 draws "Paid on
   * order" and "Due on delivery" as two computed figures, and this does not.
   *
   * `party.payment_terms` is free text — "50% on order, 50% on delivery", "30
   * jours fin de mois", "à la livraison". Splitting a payment schedule out of
   * that by pattern-matching would be right most of the time, and a wrong
   * figure on the panel that decides what SUPSERV pays is worse than no figure.
   * What is paid is read from the bank instead; what was agreed is shown in the
   * words somebody wrote.
   */
  terms: string | null;
};

export type BlockKey =
  | "deliverReceived"
  | "deliverShort"
  | "deliverNotReceived"
  | "invoiceInFull"
  | "invoiceWhatIsDelivered";

export type Block = {
  key: BlockKey;
  state: "ready" | "waiting" | "blocked";
  /** Filled for the states that carry a quantity. */
  count?: number;
};

export type PurchaseOrderView = {
  id: string;
  number: string | null;
  status: string;
  issuedOn: string | null;
  /** What the supplier promised. */
  dueOn: string | null;
  supplier: { id: string; name: string } | null;
  dealId: string | null;
  dealRef: string | null;
  receipts: ReceiptRow[];
  invoices: { id: string; number: string | null; issuedOn: string | null }[];
  match: ThreeWayMatch;
  money: Money;
  blocks: Block[];
};

/** Documents raised against this order, by kind. */
async function linked(orderId: string, kind: string) {
  return db
    .select({
      id: document.id,
      number: document.number,
      issuedOn: document.issuedOn,
      status: document.status,
      totals: document.totals,
      createdAt: document.createdAt,
      // The supplier's own BL number and who took delivery here. Left-joined:
      // a goods receipt somebody has not filled in yet is still a goods
      // receipt, and dropping it from the list would hide the arrival.
      supplierRef: deliveryDetail.counterpartyRef,
      receivedBy: deliveryDetail.receivedBy,
      receivedOn: deliveryDetail.receivedOn,
      condition: deliveryDetail.reserves,
    })
    .from(documentLink)
    .innerJoin(document, eq(document.id, documentLink.toDocument))
    .leftJoin(deliveryDetail, eq(deliveryDetail.documentId, document.id))
    .where(and(eq(documentLink.fromDocument, orderId), eq(document.kind, kind)))
    .orderBy(asc(document.createdAt));
}

export async function purchaseOrder(id: string): Promise<PurchaseOrderView | null> {
  const [order] = await db.select().from(document).where(eq(document.id, id)).limit(1);
  if (order?.kind !== "purchase_order") return null;

  const [supplier] = await db
    .select({
      id: party.id,
      name: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      terms: party.paymentTerms,
    })
    .from(party)
    .where(eq(party.id, order.partyId))
    .limit(1);

  const lines = await db
    .select()
    .from(documentLine)
    .where(and(eq(documentLine.documentId, id), eq(documentLine.lineKind, "item")))
    .orderBy(asc(documentLine.position));

  const receiptDocs = await linked(id, "goods_receipt");
  const invoiceDocs = await linked(id, "supplier_invoice");

  const receiptIds = receiptDocs.map((r) => r.id);
  const invoiceIds = invoiceDocs.map((r) => r.id);

  // One query each, then grouped in memory. The alternative is a correlated
  // sub-select per line, which is fine on five lines and is not on a BPU with
  // four hundred.
  const childLines =
    receiptIds.length + invoiceIds.length > 0
      ? await db
          .select({
            documentId: documentLine.documentId,
            sourceLineId: documentLine.sourceLineId,
            qty: documentLine.qty,
            unitPrice: documentLine.unitPrice,
          })
          .from(documentLine)
          .where(inArray(documentLine.documentId, [...receiptIds, ...invoiceIds]))
      : [];

  const isReceipt = new Set(receiptIds);
  const matchLines: MatchLine[] = lines.map((line) => {
    const mine = childLines.filter((c) => c.sourceLineId === line.id);
    const received = mine.filter((c) => isReceipt.has(c.documentId));
    const billed = mine.filter((c) => !isReceipt.has(c.documentId));

    const sumQty = (rows: typeof mine) =>
      rows.reduce((total, row) => total + Number(row.qty ?? 0), 0).toString();

    return {
      lineId: line.id,
      position: line.position,
      designation: line.designation,
      unit: line.unit,
      orderedQty: line.qty ?? "0",
      // On a purchase order the price IS the cost — it is what we pay. Reading
      // `unitCost` here would be reading the cost of a cost.
      orderedUnitCost: line.unitPrice ?? "0",
      receivedQty: sumQty(received),
      invoicedQty: billed.length > 0 ? sumQty(billed) : null,
      // The last one billed. A supplier who re-invoices a line has replaced
      // their own figure, and averaging the two would produce a price neither
      // document contains.
      invoicedUnitCost: billed.length > 0 ? (billed[billed.length - 1]?.unitPrice ?? "0") : null,
      vatRate: line.vatRate,
    };
  });

  const match = threeWayMatch(matchLines);

  const [paidRow] = invoiceIds.length
    ? await db
        .select({ paid: sql<string>`coalesce(sum(${paymentAllocation.amount}), 0)::text` })
        .from(paymentAllocation)
        .where(inArray(paymentAllocation.documentId, invoiceIds))
    : [{ paid: "0" }];

  const paid = paidRow?.paid ?? "0";

  // What the supplier has actually asked for, TTC, off the recorded factures'
  // frozen totals. The match rows are HT because the three documents state
  // unit prices HT; the money panel is TTC because that is what leaves the
  // bank, and `paid` is read from the bank. The first version mixed the two,
  // and "safe to pay" came out short by exactly the VAT.
  const invoicedIncl = invoiceDocs
    .filter((row) => row.status === "issued")
    .reduce(
      (total, row) => total + Number(((row.totals ?? {}) as { totalIncl?: string }).totalIncl ?? 0),
      0,
    )
    .toFixed(2);

  const receipts: ReceiptRow[] = receiptDocs.map((row) => ({
    id: row.id,
    number: row.number,
    // The day the goods arrived, which is what `delivery_detail` records, and
    // only failing that the day the paperwork was issued. They are usually the
    // same and the difference matters exactly when they are not.
    receivedOn: row.receivedOn ?? row.issuedOn,
    supplierRef: row.supplierRef,
    receivedBy: row.receivedBy,
    condition: row.condition,
    lines: childLines.filter((c) => c.documentId === row.id).length,
    status: row.status,
  }));

  return {
    id: order.id,
    number: order.number,
    status: order.status,
    issuedOn: order.issuedOn,
    dueOn: order.dueOn,
    supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
    dealId: order.dealId,
    dealRef: order.dealId ? await dealRef(order.dealId) : null,
    receipts,
    invoices: invoiceDocs.map((row) => ({
      id: row.id,
      number: row.number,
      issuedOn: row.issuedOn,
    })),
    match,
    money: {
      currency: order.currency,
      // HT, from the lines, like the rows above it.
      ordered: match.total.ordered,
      // TTC, from the recorded factures — see `invoicedIncl`.
      invoiced: invoicedIncl,
      paid,
      held: match.heldIncl,
      safeToPay: safeToPayNow({ invoiced: invoicedIncl, paid, held: match.heldIncl }),
      terms: supplier?.terms ?? null,
    },
    blocks: blocksFor(match),
  };
}

async function dealRef(dealId: string): Promise<string | null> {
  const [row] = await db.select({ ref: deal.ref }).from(deal).where(eq(deal.id, dealId)).limit(1);
  return row?.ref ?? null;
}

/**
 * What this order is holding up, on the CLIENT side.
 *
 * The frame's most useful panel, and the reason it is here rather than on
 * screen 13: a purchase order matters to the people running the company only
 * through what it stops them doing. "Line 5 not received" is a fact about a
 * supplier; "you cannot invoice the client in full" is the consequence, and it
 * is the sentence somebody acts on.
 *
 * Computed from the match, never stored. Nothing here writes.
 */
export function blocksFor(match: ThreeWayMatch): Block[] {
  const complete = match.lines.filter((l) => l.state === "complete" || l.state === "over");
  const short = match.lines.filter((l) => l.state === "partial");
  const awaiting = match.lines.filter((l) => l.state === "awaiting");
  const anythingArrived = match.lines.some((l) => l.state !== "awaiting");

  const blocks: Block[] = [];

  if (complete.length > 0) {
    blocks.push({ key: "deliverReceived", state: "ready", count: complete.length });
  }
  if (short.length > 0) {
    blocks.push({ key: "deliverShort", state: "waiting", count: short.length });
  }
  if (awaiting.length > 0) {
    blocks.push({ key: "deliverNotReceived", state: "waiting", count: awaiting.length });
  }

  blocks.push({
    key: "invoiceInFull",
    state: short.length === 0 && awaiting.length === 0 ? "ready" : "blocked",
  });

  // Allowed as soon as anything has arrived, and this is the point of the
  // panel: an order held up by one line does not have to hold up the invoice
  // for the four that came.
  blocks.push({
    key: "invoiceWhatIsDelivered",
    state: anythingArrived ? "ready" : "blocked",
  });

  return blocks;
}
