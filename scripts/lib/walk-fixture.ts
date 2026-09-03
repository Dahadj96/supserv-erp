import { asc, eq, inArray, like } from "drizzle-orm";
import { db } from "../../src/db";
import { auditEntry } from "../../src/db/schema/control";
import { deal, dealLine, priceQuote } from "../../src/db/schema/deal";
import { deliveryDetail } from "../../src/db/schema/delivery";
import { document, documentLine, documentLink, numberingSeries } from "../../src/db/schema/document";
import { payment, paymentAllocation } from "../../src/db/schema/money";
import { party, partyAlias, partyRole } from "../../src/db/schema/party";
import { billFrom } from "../../src/documents/bill";
import { ensureRulesExist } from "../../src/documents/compliance";
import { convertDocument } from "../../src/documents/convert";
import { render } from "../../src/documents/engine";
import { createDeal } from "../../src/domain/deal/deal";
import { replaceLines } from "../../src/domain/deal/lines";
import { addQuote } from "../../src/domain/deal/price-store";
import { createRequest, markSent, recordAnswer } from "../../src/domain/deal/sourcing-store";
import { recordSignedCopy, startDelivery } from "../../src/domain/delivery/store";
import { ensureTypesExist } from "../../src/domain/document-types";
import { recordPayment } from "../../src/domain/money/store";
import { buildOffer } from "../../src/domain/offer/build";
import { markSubmitted } from "../../src/domain/offer/store";
import { createParty } from "../../src/domain/party";
import { orderFromAnswer, receiveGoods, recordSupplierInvoice } from "../../src/domain/purchase/store";
import { sourcingRequest, sourcingResponse } from "../../src/db/schema/sourcing";

/**
 * The A-to-Z walk as a fixture: the same enquiry `tests/integration/a-to-z.test.ts`
 * drives, left IN the database so a browser can look at every screen with
 * something real on it. Every party it creates is named "… (TEST A-Z)", which
 * is how `teardownWalk` finds everything again.
 *
 * Series are created only if the kind has none; nothing already configured is
 * touched. Meant for the TEST database — the screenshot script refuses to run
 * against anything else.
 */
export type WalkIds = {
  clientId: string;
  supplierId: string | null;
  dealId: string;
  offerId: string;
  orderId: string;
  blId: string;
  invoiceId: string;
  draftInvoiceId: string;
  purchaseOrderId: string | null;
};

export async function seedWalk(actorId: string): Promise<WalkIds> {
  await ensureRulesExist();
  await ensureTypesExist();
  for (const [kind, pattern] of [
    ["proforma", "PF-{YYYY}-{####}"],
    ["delivery_note", "BL-{YYYY}-{####}"],
    ["invoice", "FA-{YYYY}-{####}"],
    ["purchase_order", "PO-{YYYY}-{####}"],
    ["goods_receipt", "BR-{YYYY}-{####}"],
  ] as const) {
    const [existing] = await db.select().from(numberingSeries).where(eq(numberingSeries.kind, kind));
    if (!existing) await db.insert(numberingSeries).values({ kind, pattern, reset: "yearly" });
  }

  const client = await createParty(
    {
      legalName: "ENAGEO ADRAR (TEST A-Z)",
      tradeName: "",
      roles: ["client"],
      nif: "000116007654321",
      nis: "",
      rc: "",
      ai: "",
      email: "",
      phone: "",
      address: "Base de vie, Adrar",
      wilaya: "Adrar",
      docLocale: "fr",
      emailLocale: "fr",
      currency: "DZD",
      paymentTerms: "",
    },
    actorId,
  );

  const dealId = await createDeal(
    {
      partyId: client.id,
      subject: "Fourniture de galets de convoyeur",
      contactPersonId: null,
      clientReference: "DA 2026/118",
      receivedAt: new Date("2026-09-01T08:00:00Z"),
      deadlineAt: new Date("2026-09-15T16:00:00Z"),
      submissionMethod: "email",
      currency: "DZD",
      ownerId: null,
      source: "manual",
      intakeMessageId: null,
      expectedValue: "60000",
      clientInstructions: null,
    },
    actorId,
  );
  await replaceLines({
    dealId,
    lines: [
      {
        position: 1,
        reference: "01",
        designation: "Galet de convoyeur Ø89 × 315 mm",
        qty: "10",
        unit: "U",
        readAs: "tabs",
        qtyAssumed: false,
      },
      {
        position: 2,
        reference: "02",
        designation: "Transport Adrar → base",
        qty: "1",
        unit: "Fft",
        readAs: "tabs",
        qtyAssumed: false,
      },
    ],
    actorId,
  });
  const lines = await db
    .select()
    .from(dealLine)
    .where(eq(dealLine.dealId, dealId))
    .orderBy(asc(dealLine.position));
  const quote = {
    dealId,
    currency: "DZD",
    isExclVat: true,
    isVerbal: false,
    validUntil: null,
    capturedPlace: null,
    capturedFrom: null,
    actorId,
  };
  await addQuote({
    ...quote,
    dealLineId: lines[0]?.id ?? null,
    source: "supplier_email",
    supplierName: "FOURNISSEUR ROULEMENTS (TEST A-Z)",
    price: "4000",
  });
  await addQuote({
    ...quote,
    dealLineId: lines[1]?.id ?? null,
    source: "internal_costing",
    supplierName: null,
    price: "1500",
  });
  const [supplier] = await db
    .select({ id: party.id })
    .from(party)
    .where(eq(party.legalName, "FOURNISSEUR ROULEMENTS (TEST A-Z)"));

  const offerId = await buildOffer({ dealId, kind: "proforma", defaultMarginPct: "20", actorId });
  await render({ documentId: offerId, purpose: "issue", actorId });
  await markSubmitted({ offerId, place: "email", proofRef: null, when: new Date(), actorId });

  const orderId = await convertDocument({
    documentId: offerId,
    target: "client_order",
    invoiceDate: "2026-09-03",
    dueDate: null,
    paymentMethod: null,
    settlement: "virement",
    clientReference: "BC 2026/0457",
    actorId,
  });
  await render({ documentId: orderId, purpose: "issue", actorId });
  const orderLines = await db
    .select({ id: documentLine.id })
    .from(documentLine)
    .where(eq(documentLine.documentId, orderId))
    .orderBy(asc(documentLine.position));
  const galets = orderLines[0]?.id as string;
  const transport = orderLines[1]?.id as string;

  const blId = await startDelivery({
    sourceId: orderId,
    quantities: { [galets]: "6" },
    deliverOn: "2026-09-05",
    actorId,
  });
  await render({ documentId: blId, purpose: "issue", actorId });
  await recordSignedCopy({
    documentId: blId,
    receivedBy: "M. Benali, magasinier",
    receivedOn: "2026-09-05",
    reserves: null,
    actorId,
  });

  const invoiceId = await billFrom({
    sourceId: orderId,
    quantities: { [galets]: "6" },
    invoiceDate: "2026-09-06",
    dueDate: "2026-10-06",
    actorId,
  });
  await render({ documentId: invoiceId, purpose: "issue", actorId });
  await recordPayment({
    partyId: client.id,
    method: "virement",
    amount: "20000.00",
    receivedOn: "2026-09-20",
    bankRef: "VIR 2026-09-20",
    allocations: { [invoiceId]: "20000.00" },
    actorId,
  });

  // The buy side of the same enquiry: the supplier asked, answered, ordered
  // from, delivered short, and billed — so screen 68 has a match to show.
  let purchaseOrderId: string | null = null;
  if (supplier) {
    const requestId = await createRequest({
      dealId,
      subject: "Galets de convoyeur",
      supplierIds: [supplier.id],
      replyBy: new Date("2026-09-05T16:00:00Z"),
      actorId,
    });
    await markSent({ requestId, actorId, when: new Date("2026-09-02T09:00:00Z") });
    const [answer] = await db
      .select({ id: sourcingResponse.id })
      .from(sourcingResponse)
      .where(eq(sourcingResponse.requestId, requestId));
    if (answer) {
      await recordAnswer({
        responseId: answer.id,
        status: "quoted",
        validityDays: 30,
        leadTimeDays: 7,
        prices: { [lines[0]?.id as string]: "4000" },
        actorId,
      });
      purchaseOrderId = await orderFromAnswer({ responseId: answer.id, actorId });
      await render({ documentId: purchaseOrderId, purpose: "issue", actorId });
      const [poLine] = await db
        .select({ id: documentLine.id })
        .from(documentLine)
        .where(eq(documentLine.documentId, purchaseOrderId));
      const receiptId = await receiveGoods({
        orderId: purchaseOrderId,
        quantities: { [poLine?.id as string]: "6" },
        receivedOn: "2026-09-04",
        supplierRef: "BL 4471",
        receivedBy: "Magasin Adrar",
        reserves: "4 manquants",
        actorId,
      });
      await render({ documentId: receiptId, purpose: "issue", actorId });
      const supplierInvoiceId = await recordSupplierInvoice({
        orderId: purchaseOrderId,
        theirNumber: "F-2026-0088",
        invoiceDate: "2026-09-05",
        dueDate: "2026-10-05",
        lines: { [poLine?.id as string]: { qty: "10", unitPrice: "4100" } },
        settlement: "virement",
        actorId,
      });
      await render({ documentId: supplierInvoiceId, purpose: "issue", actorId });
    }
  }

  // Left as a draft on purpose: the builder and the checklist need one.
  const draftInvoiceId = await billFrom({
    sourceId: orderId,
    quantities: { [galets]: "4", [transport]: "1" },
    invoiceDate: "2026-09-26",
    dueDate: "2026-10-26",
    actorId,
  });

  return {
    clientId: client.id,
    supplierId: supplier?.id ?? null,
    dealId,
    offerId,
    orderId,
    blId,
    invoiceId,
    draftInvoiceId,
    purchaseOrderId,
  };
}

export async function teardownWalk(actorId: string): Promise<void> {
  const parties = await db
    .select({ id: party.id })
    .from(party)
    .where(like(party.legalName, "% (TEST A-Z)"));
  const partyIds = parties.map((p) => p.id);
  if (partyIds.length > 0) {
    const docs = await db
      .select({ id: document.id })
      .from(document)
      .where(inArray(document.partyId, partyIds));
    const docIds = docs.map((d) => d.id);
    await db.delete(paymentAllocation).where(
      inArray(
        paymentAllocation.paymentId,
        db.select({ id: payment.id }).from(payment).where(inArray(payment.partyId, partyIds)),
      ),
    );
    await db.delete(payment).where(inArray(payment.partyId, partyIds));
    if (docIds.length > 0) {
      await db.delete(deliveryDetail).where(inArray(deliveryDetail.documentId, docIds));
      await db.delete(documentLink).where(inArray(documentLink.fromDocument, docIds));
      await db.delete(documentLink).where(inArray(documentLink.toDocument, docIds));
      await db.delete(documentLine).where(inArray(documentLine.documentId, docIds));
      await db.delete(document).where(inArray(document.id, docIds));
    }
    const deals = await db.select({ id: deal.id }).from(deal).where(inArray(deal.partyId, partyIds));
    const dealIds = deals.map((d) => d.id);
    if (dealIds.length > 0) {
      await db.delete(sourcingRequest).where(inArray(sourcingRequest.dealId, dealIds));
      await db.delete(priceQuote).where(inArray(priceQuote.dealId, dealIds));
      await db.delete(dealLine).where(inArray(dealLine.dealId, dealIds));
      await db.delete(deal).where(inArray(deal.id, dealIds));
    }
    await db.delete(partyRole).where(inArray(partyRole.partyId, partyIds));
    await db.delete(partyAlias).where(inArray(partyAlias.partyId, partyIds));
    await db.delete(party).where(inArray(party.id, partyIds));
  }
  await db.delete(auditEntry).where(eq(auditEntry.actorId, actorId));
}
