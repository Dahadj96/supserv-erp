import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { deliveryDetail } from "@/db/schema/delivery";
import { document, documentLine, documentLink } from "@/db/schema/document";
import { payment, paymentAllocation } from "@/db/schema/money";
import { party, partyRole } from "@/db/schema/party";
import { purchaseOrder } from "@/domain/purchase/order";

/**
 * Screen 68 against a real database.
 *
 * The unit tests prove the arithmetic. What only a database can prove is the
 * thing the whole screen rests on: that a goods receipt line and a supplier
 * invoice line find their way back to the RIGHT purchase order line, through
 * `document_line.source_line_id`, across three separate documents.
 *
 * Two lines are deliberately given the same designation. Matching on the words
 * instead of the id would collapse them, and the screen would report a price
 * difference on an order where nothing is wrong.
 */
const ACTOR = "test-po-actor";

let supplierId = "";
let orderId = "";
const documents: string[] = [];
const payments: string[] = [];
let lineIds: string[] = [];

async function makeDocument(kind: string, number: string | null, over = {}) {
  const [row] = await db
    .insert(document)
    .values({
      kind,
      number,
      partyId: supplierId,
      locale: "fr",
      currency: "DZD",
      status: number ? "issued" : "draft",
      totals: {},
      issuedOn: "2026-08-21",
      ...over,
    })
    .returning({ id: document.id });
  const id = row?.id as string;
  documents.push(id);
  return id;
}

beforeAll(async () => {
  const [supplier] = await db
    .insert(party)
    .values({
      code: `SU-9${Date.now().toString().slice(-5)}`,
      legalName: "SARL HYDRO-EQUIP (TEST)",
      tradeName: "HYDRO-EQUIP",
      paymentTerms: "50% on order, 50% on delivery",
    })
    .returning({ id: party.id });
  supplierId = supplier?.id as string;
  await db.insert(partyRole).values({ partyId: supplierId, role: "supplier" });

  orderId = await makeDocument("purchase_order", "PO-2026-9034", { dueOn: "2026-09-04" });

  const lines = await db
    .insert(documentLine)
    .values([
      {
        documentId: orderId,
        position: 1,
        lineKind: "item",
        designation: "Vanne papillon DN80 PN16",
        unit: "pc",
        qty: "12",
        unitPrice: "38400",
      },
      {
        documentId: orderId,
        position: 2,
        lineKind: "item",
        // THE SAME WORDS as line 1, at a different price. If anything in this
        // module ever matches on designation, this line is what breaks it.
        designation: "Vanne papillon DN80 PN16",
        unit: "pc",
        qty: "8",
        unitPrice: "41100",
      },
      {
        documentId: orderId,
        position: 3,
        lineKind: "item",
        designation: 'Raccord bride 2" galvanisé',
        unit: "pc",
        qty: "40",
        unitPrice: "2610",
      },
    ])
    .returning({ id: documentLine.id });
  lineIds = lines.map((l) => l.id);

  // One receipt: lines 1 and 2 arrived in full, line 3 never came.
  const receiptId = await makeDocument("goods_receipt", "BR-2026-9021", { issuedOn: "2026-08-24" });
  await db.insert(documentLink).values({
    fromDocument: orderId,
    toDocument: receiptId,
    relation: "covers",
  });
  await db.insert(deliveryDetail).values({
    documentId: receiptId,
    counterpartyRef: "BL-HE-4412",
    receivedBy: "A. Dahadj",
    receivedOn: "2026-08-24",
  });
  await db.insert(documentLine).values([
    { documentId: receiptId, position: 1, lineKind: "item", sourceLineId: lineIds[0], qty: "12" },
    { documentId: receiptId, position: 2, lineKind: "item", sourceLineId: lineIds[1], qty: "8" },
  ]);

  // The supplier's invoice: everything billed, and line 3 repriced upward
  // despite never having arrived.
  const invoiceId = await makeDocument("supplier_invoice", "FA-HE-2026-771");
  await db.insert(documentLink).values({
    fromDocument: orderId,
    toDocument: invoiceId,
    relation: "covers",
  });
  await db.insert(documentLine).values([
    {
      documentId: invoiceId,
      position: 1,
      lineKind: "item",
      sourceLineId: lineIds[0],
      qty: "12",
      unitPrice: "38400",
    },
    {
      documentId: invoiceId,
      position: 2,
      lineKind: "item",
      sourceLineId: lineIds[1],
      qty: "8",
      unitPrice: "41100",
    },
    {
      documentId: invoiceId,
      position: 3,
      lineKind: "item",
      sourceLineId: lineIds[2],
      qty: "40",
      unitPrice: "3660",
    },
  ]);

  const [paid] = await db
    .insert(payment)
    .values({
      partyId: supplierId,
      method: "virement",
      amount: "400000",
      receivedOn: "2026-08-22",
      recordedBy: ACTOR,
    })
    .returning({ id: payment.id });
  payments.push(paid?.id as string);
  await db
    .insert(paymentAllocation)
    .values({ paymentId: paid?.id as string, documentId: invoiceId, amount: "400000" });
});

afterAll(async () => {
  if (payments.length) {
    await db.delete(paymentAllocation).where(inArray(paymentAllocation.paymentId, payments));
    await db.delete(payment).where(inArray(payment.id, payments));
  }
  if (documents.length) {
    await db.delete(deliveryDetail).where(inArray(deliveryDetail.documentId, documents));
    await db.delete(documentLink).where(inArray(documentLink.fromDocument, documents));
    await db.delete(documentLine).where(inArray(documentLine.documentId, documents));
    await db.delete(document).where(inArray(document.id, documents));
  }
  if (supplierId) {
    await db.delete(partyRole).where(eq(partyRole.partyId, supplierId));
    await db.delete(party).where(eq(party.id, supplierId));
  }
});

describe("a supplier order, its receipts and its invoice", () => {
  it("is nothing at all when the id is not a purchase order", async () => {
    const receipt = documents.find((id) => id !== orderId) as string;
    expect(await purchaseOrder(receipt)).toBeNull();
  });

  it("carries the supplier and what they promised", async () => {
    const view = await purchaseOrder(orderId);
    expect(view?.supplier?.name).toBe("HYDRO-EQUIP");
    expect(view?.dueOn).toBe("2026-09-04");
    expect(view?.money.terms).toBe("50% on order, 50% on delivery");
  });

  it("counts what arrived per line, through source_line_id", async () => {
    const view = await purchaseOrder(orderId);
    expect(view?.match.lines.map((l) => l.receivedQty)).toEqual(["12", "8", "0"]);
  });

  it("does not collapse two lines that read exactly the same", async () => {
    // Lines 1 and 2 share a designation and differ in price. Matched by words,
    // one of them would report a price difference that does not exist.
    const view = await purchaseOrder(orderId);
    const wrong = view?.match.lines.filter((l) => l.price === "doesNotMatch");
    expect(wrong?.map((l) => l.position)).toEqual([3]);
  });

  it("holds the repriced line and nothing else", async () => {
    const view = await purchaseOrder(orderId);
    // (3 660 − 2 610) × 40
    expect(view?.money.held).toBe("42000.00");
    expect(view?.match.clean).toBe(false);
  });

  it("reads what has been paid off the bank, not off the terms", async () => {
    const view = await purchaseOrder(orderId);
    expect(view?.money.paid).toBe("400000.00");
  });

  it("takes the held amount off before saying what is safe to pay", async () => {
    const view = await purchaseOrder(orderId);
    const invoiced = Number(view?.money.invoiced);
    expect(Number(view?.money.safeToPay)).toBe(invoiced - 400_000 - 42_000);
  });

  it("keeps the supplier's own BL number, which is the one they will quote", async () => {
    const view = await purchaseOrder(orderId);
    expect(view?.receipts[0]?.supplierRef).toBe("BL-HE-4412");
    expect(view?.receipts[0]?.receivedBy).toBe("A. Dahadj");
  });

  it("says the client can be invoiced for what arrived, and not in full", async () => {
    const view = await purchaseOrder(orderId);
    const state = (key: string) => view?.blocks.find((b) => b.key === key)?.state;
    expect(state("invoiceWhatIsDelivered")).toBe("ready");
    expect(state("invoiceInFull")).toBe("blocked");
    expect(state("deliverNotReceived")).toBe("waiting");
  });

  it("writes nothing", async () => {
    // Screen 68 reads three documents and computes. Any write here would be a
    // status column arriving by the back door.
    const before = await db.select().from(documentLine).where(eq(documentLine.documentId, orderId));
    await purchaseOrder(orderId);
    const after = await db.select().from(documentLine).where(eq(documentLine.documentId, orderId));
    expect(after).toEqual(before);
  });
});
