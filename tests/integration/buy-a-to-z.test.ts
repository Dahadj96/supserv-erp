import { asc, eq, inArray, like } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { COMPANY_ID, companyIdentity, vatRate } from "@/db/schema/company";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine, priceQuote } from "@/db/schema/deal";
import { deliveryDetail } from "@/db/schema/delivery";
import { document, documentLine, documentLink, numberingSeries } from "@/db/schema/document";
import { payment, paymentAllocation } from "@/db/schema/money";
import { party, partyAlias, partyRole } from "@/db/schema/party";
import { sourcingRequest } from "@/db/schema/sourcing";
import { ensureRulesExist } from "@/documents/compliance";
import { render } from "@/documents/engine";
import { toPdf } from "@/documents/pdf";
import { saveIdentity, setLogo } from "@/domain/company";
import { createDeal } from "@/domain/deal/deal";
import { replaceLines } from "@/domain/deal/lines";
import { createRequest, markSent, recordAnswer, requestFor } from "@/domain/deal/sourcing-store";
import { ensureTypesExist } from "@/domain/document-types";
import { PaymentRefused, recordPayment, unallocated } from "@/domain/money/store";
import { createParty } from "@/domain/party";
import { purchaseOrder } from "@/domain/purchase/order";
import {
  CannotBuy,
  orderFromAnswer,
  payables,
  receiveGoods,
  recordSupplierInvoice,
} from "@/domain/purchase/store";

const spaces = (s: string | undefined) => (s ?? "").replace(/[  ]/g, " ");
async function pdfText(bytes: Buffer): Promise<string> {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), {
    mergePages: true,
  });
  return spaces(text);
}

/**
 * The buy side, walked the way a person walks it.
 *
 * Enquiry → ask two suppliers → both answer → order from the cheaper one →
 * the goods arrive short → their facture arrives for more than arrived → the
 * three-way match holds the difference → the rest arrives → we pay them.
 * Every step is the function the screen calls.
 *
 * Before this file, screen 68 could be read and not driven: there was no
 * way to place an order from an answer, none to record an arrival, none to
 * record the supplier's facture, and `recordPayment` refused a supplier
 * invoice as "no such invoice".
 */
const ACTOR = "test-buy-a-to-z-actor";
const SERIES = ["purchase_order", "goods_receipt"] as const;

const IDENTITY = {
  legalName: "SARL SUP SERV",
  tradeName: "SUPSERV",
  legalForm: "SARL",
  capital: "6 000 000,00 DA",
  rc: "01/00-0883062 B19",
  nif: "001901088306288",
  nis: "001901010000282",
  ai: "01011120488",
  address: "N°19, Cité 67 Logements, 01000 Adrar",
  wilaya: "Adrar",
  phone: "0663 00 00 65",
  email: "contact@supserv.dz",
  website: "www.supserv.dz",
};

let previousIdentity: typeof companyIdentity.$inferSelect | undefined;
const previousSeries = new Map<string, typeof numberingSeries.$inferSelect>();
let clientId: string;
let cheapId: string;
let dearId: string;
let dealId: string;
let requestId: string;
let cheapAnswerId: string;
let dearAnswerId: string;
let orderId: string;
let orderLines: { id: string; designation: string | null }[] = [];
let firstInvoiceId: string;

const stored = async (id: string) =>
  (await db.select().from(document).where(eq(document.id, id)))[0] as typeof document.$inferSelect;

function supplier(name: string, docLocale: "fr" | "en" = "fr") {
  return {
    legalName: name,
    tradeName: "",
    roles: ["supplier" as const],
    nif: "",
    nis: "",
    rc: "",
    ai: "",
    email: "",
    phone: "",
    address: "Zone industrielle, Oran",
    wilaya: "Oran",
    docLocale,
    emailLocale: docLocale,
    currency: "DZD",
    paymentTerms: "30 jours",
  };
}

beforeAll(async () => {
  [previousIdentity] = await db
    .select()
    .from(companyIdentity)
    .where(eq(companyIdentity.id, COMPANY_ID));
  await saveIdentity(IDENTITY, ACTOR);
  await setLogo("company/logo-test.png", ACTOR);
  await ensureRulesExist();
  await ensureTypesExist();

  for (const kind of SERIES) {
    const [existing] = await db
      .select()
      .from(numberingSeries)
      .where(eq(numberingSeries.kind, kind));
    if (existing) previousSeries.set(kind, existing);
    await db.delete(numberingSeries).where(eq(numberingSeries.kind, kind));
  }
  await db.insert(numberingSeries).values([
    { kind: "purchase_order", pattern: "BZPO-{YYYY}-{####}", reset: "yearly", nextValue: 1 },
    { kind: "goods_receipt", pattern: "BZBR-{YYYY}-{####}", reset: "yearly", nextValue: 1 },
  ]);
  await db.delete(vatRate).where(like(vatRate.authority, "TESTBZ %"));
  await db.insert(vatRate).values({
    rate: "19.000",
    kind: "normal",
    startsOn: "2017-01-01",
    authority: "TESTBZ CTCA art. 21",
  });

  const client = await createParty(
    { ...supplier("SONELGAZ DISTRIBUTION (TEST B-Z)"), roles: ["client"], nif: "000116007654321" },
    ACTOR,
  );
  clientId = client.id;
  cheapId = (await createParty(supplier("ROULEMENTS DU SUD (TEST B-Z)"), ACTOR)).id;
  dearId = (await createParty(supplier("BEARINGS EXPORT (TEST B-Z)", "en"), ACTOR)).id;
});

afterAll(async () => {
  const parties = await db
    .select({ id: party.id })
    .from(party)
    .where(like(party.legalName, "% (TEST B-Z)"));
  const partyIds = parties.map((p) => p.id);
  if (partyIds.length > 0) {
    const docs = await db
      .select({ id: document.id })
      .from(document)
      .where(inArray(document.partyId, partyIds));
    const docIds = docs.map((d) => d.id);
    await db
      .delete(paymentAllocation)
      .where(
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
    const deals = await db
      .select({ id: deal.id })
      .from(deal)
      .where(inArray(deal.partyId, partyIds));
    const dealIds = deals.map((d) => d.id);
    if (dealIds.length > 0) {
      // Sourcing rows cascade from the request; the request cascades from the deal.
      await db.delete(sourcingRequest).where(inArray(sourcingRequest.dealId, dealIds));
      await db.delete(priceQuote).where(inArray(priceQuote.dealId, dealIds));
      await db.delete(dealLine).where(inArray(dealLine.dealId, dealIds));
      await db.delete(deal).where(inArray(deal.id, dealIds));
    }
    await db.delete(partyRole).where(inArray(partyRole.partyId, partyIds));
    await db.delete(partyAlias).where(inArray(partyAlias.partyId, partyIds));
    await db.delete(party).where(inArray(party.id, partyIds));
  }
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  for (const kind of SERIES) {
    await db.delete(numberingSeries).where(eq(numberingSeries.kind, kind));
    const previous = previousSeries.get(kind);
    if (previous) await db.insert(numberingSeries).values(previous);
  }
  await db.delete(vatRate).where(like(vatRate.authority, "TESTBZ %"));
  if (previousIdentity) {
    await db
      .update(companyIdentity)
      .set(previousIdentity)
      .where(eq(companyIdentity.id, COMPANY_ID));
  } else {
    await db.delete(companyIdentity).where(eq(companyIdentity.id, COMPANY_ID));
  }
});

describe("B to Z — the buy side, walked the way a person walks it", () => {
  it("1. the enquiry, with two lines to source", async () => {
    dealId = await createDeal(
      {
        partyId: clientId,
        subject: "Roulements pour convoyeur",
        contactPersonId: null,
        clientReference: "DA 2026/204",
        receivedAt: new Date("2026-09-01T08:00:00Z"),
        deadlineAt: new Date("2026-09-20T16:00:00Z"),
        submissionMethod: "email",
        currency: "DZD",
        ownerId: null,
        source: "manual",
        intakeMessageId: null,
        expectedValue: null,
        clientInstructions: null,
      },
      ACTOR,
    );
    await replaceLines({
      dealId,
      lines: [
        {
          position: 1,
          reference: "01",
          designation: "Roulement 6205-2RS",
          qty: "40",
          unit: "U",
          readAs: "tabs",
          qtyAssumed: false,
        },
        {
          position: 2,
          reference: "02",
          designation: "Roulement 6308-ZZ",
          qty: "12",
          unit: "U",
          readAs: "tabs",
          qtyAssumed: false,
        },
      ],
      actorId: ACTOR,
    });
  });

  it("2. two suppliers are asked, and nothing can be ordered before the request is sent", async () => {
    requestId = await createRequest({
      dealId,
      subject: "Roulements",
      supplierIds: [cheapId, dearId],
      replyBy: new Date("2026-09-08T16:00:00Z"),
      actorId: ACTOR,
    });
    const found = await requestFor(requestId);
    expect(found).not.toBeNull();

    const { sourcingResponse } = await import("@/db/schema/sourcing");
    const answers = await db
      .select({ id: sourcingResponse.id, partyId: sourcingResponse.partyId })
      .from(sourcingResponse)
      .where(eq(sourcingResponse.requestId, requestId));
    cheapAnswerId = answers.find((a) => a.partyId === cheapId)?.id as string;
    dearAnswerId = answers.find((a) => a.partyId === dearId)?.id as string;

    await expect(orderFromAnswer({ responseId: cheapAnswerId, actorId: ACTOR })).rejects.toThrow(
      "requestNotSent",
    );
    await markSent({ requestId, actorId: ACTOR, when: new Date("2026-09-02T09:00:00Z") });
    // Asked is not quoted.
    await expect(orderFromAnswer({ responseId: cheapAnswerId, actorId: ACTOR })).rejects.toThrow(
      "notQuoted",
    );
  });

  it("3. both answer; the cheaper one has no price for the second line", async () => {
    const lines = await db
      .select({ id: dealLine.id })
      .from(dealLine)
      .where(eq(dealLine.dealId, dealId))
      .orderBy(asc(dealLine.position));
    const [l1, l2] = lines.map((l) => l.id) as [string, string];

    await recordAnswer({
      responseId: cheapAnswerId,
      status: "quoted",
      validityDays: 30,
      leadTimeDays: 7,
      prices: { [l1]: "1 250,00", [l2]: "" },
      actorId: ACTOR,
    });
    await recordAnswer({
      responseId: dearAnswerId,
      status: "quoted",
      validityDays: 15,
      leadTimeDays: 21,
      prices: { [l1]: "1400", [l2]: "3900" },
      actorId: ACTOR,
    });
  });

  it("4. the order goes to the cheaper supplier, for the line they priced, at their price", async () => {
    orderId = await orderFromAnswer({ responseId: cheapAnswerId, actorId: ACTOR });
    const order = await stored(orderId);
    expect(order.kind).toBe("purchase_order");
    expect(order.partyId).toBe(cheapId);
    expect(order.dealId).toBe(dealId);
    expect(order.number).toBeNull();
    // Seven days' lead time from today.
    expect(order.dueOn).toBe(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));

    orderLines = await db
      .select({ id: documentLine.id, designation: documentLine.designation })
      .from(documentLine)
      .where(eq(documentLine.documentId, orderId))
      .orderBy(asc(documentLine.position));
    expect(orderLines.map((l) => l.designation)).toEqual(["Roulement 6205-2RS"]);
    // 40 × 1 250 = 50 000 HT, 59 500 TTC.
    expect((order.totals as { totalIncl: string }).totalIncl).toBe("59500.00");

    // Nothing can arrive against a draft.
    await expect(
      receiveGoods({
        orderId,
        quantities: { [orderLines[0]?.id as string]: "40" },
        receivedOn: "2026-09-09",
        actorId: ACTOR,
      }),
    ).rejects.toThrow("orderNotIssued");

    const out = await render({ documentId: orderId, purpose: "issue", actorId: ACTOR });
    expect(out.number).toMatch(/^BZPO-\d{4}-0001$/);
    const text = await pdfText(await toPdf(out));
    expect(text).toContain("ROULEMENTS DU SUD");
    expect(text).toContain("59 500,00");

    // The second line — unpriced by them — goes to the other supplier.
    const second = await orderFromAnswer({ responseId: dearAnswerId, actorId: ACTOR });
    const lines2 = await db
      .select({ designation: documentLine.designation, unitPrice: documentLine.unitPrice })
      .from(documentLine)
      .where(eq(documentLine.documentId, second));
    expect(lines2.map((l) => l.designation)).toEqual(["Roulement 6205-2RS", "Roulement 6308-ZZ"]);
    const dear = await stored(second);
    expect(dear.locale, "LAW 4 — the order speaks the supplier's language").toBe("en");
  });

  it("5. the goods arrive short: 30 of 40, and the receipt says so", async () => {
    const line = orderLines[0]?.id as string;
    await expect(
      receiveGoods({
        orderId,
        quantities: { "00000000-0000-4000-8000-000000000000": "1" },
        receivedOn: "2026-09-09",
        actorId: ACTOR,
      }),
    ).rejects.toBeInstanceOf(CannotBuy);

    const receiptId = await receiveGoods({
      orderId,
      quantities: { [line]: "30" },
      receivedOn: "2026-09-09",
      supplierRef: "BL 4471",
      receivedBy: "Magasin Adrar",
      reserves: "10 manquants, carton 3 abîmé",
      actorId: ACTOR,
    });
    const receipt = await stored(receiptId);
    expect(receipt.kind).toBe("goods_receipt");
    expect(receipt.totals).toEqual({});
    const out = await render({ documentId: receiptId, purpose: "issue", actorId: ACTOR });
    expect(out.number).toMatch(/^BZBR-\d{4}-0001$/);
    expect(out.totals, "a receipt carries no money").toEqual([]);

    const view = await purchaseOrder(orderId);
    expect(view?.receipts).toHaveLength(1);
    expect(view?.receipts[0]).toMatchObject({
      supplierRef: "BL 4471",
      receivedBy: "Magasin Adrar",
      condition: "10 manquants, carton 3 abîmé",
      lines: 1,
    });
    expect(view?.match.lines[0]).toMatchObject({ receivedQty: "30", state: "partial" });
    expect(view?.blocks.find((b) => b.key === "invoiceWhatIsDelivered")?.state).toBe("ready");
    expect(view?.blocks.find((b) => b.key === "invoiceInFull")?.state).toBe("blocked");
  });

  it("6. their facture arrives for the full 40, at a higher price — and the match holds the difference", async () => {
    const line = orderLines[0]?.id as string;
    await expect(
      recordSupplierInvoice({
        orderId,
        theirNumber: " ",
        invoiceDate: "2026-09-10",
        lines: { [line]: { qty: "40", unitPrice: "1300" } },
        actorId: ACTOR,
      }),
    ).rejects.toThrow("theirNumberRequired");

    firstInvoiceId = await recordSupplierInvoice({
      orderId,
      theirNumber: "F-2026-0088",
      invoiceDate: "2026-09-10",
      dueDate: "2026-10-10",
      lines: { [line]: { qty: "40", unitPrice: "1300" } },
      settlement: "virement",
      actorId: ACTOR,
    });
    const invoice = await stored(firstInvoiceId);
    expect(invoice.kind).toBe("supplier_invoice");
    expect(invoice.number, "their number, verbatim").toBe("F-2026-0088");
    // 40 × 1 300 = 52 000 HT → 61 880 TTC.
    expect((invoice.totals as { totalIncl: string }).totalIncl).toBe("61880.00");

    // Not owed until recorded.
    expect(await payables({ partyId: cheapId })).toEqual([]);
    const out = await render({ documentId: firstInvoiceId, purpose: "issue", actorId: ACTOR });
    expect(out.number, "recording takes no number of ours").toBe("F-2026-0088");
    expect(out.issued).toBe(true);
    expect((await payables({ partyId: cheapId }))[0]?.totalIncl).toBe("61880.00");

    const view = await purchaseOrder(orderId);
    expect(view?.match.quantity.verdict, "billed 40, received 30").toBe("doesNotMatch");
    expect(view?.match.lines[0]?.price).toBe("doesNotMatch");
    // (1 300 − 1 250) × 40 billed = 2 000 HT held; 2 380 with the VAT on it.
    expect(view?.match.held).toBe("2000.00");
    expect(view?.match.heldIncl).toBe("2380.00");
    expect(view?.match.total.verdict).toBe("doesNotMatch");
    // The money panel is TTC — it is what leaves the bank.
    expect(view?.money.invoiced).toBe("61880.00");
    expect(view?.money.paid).toBe("0");
    expect(view?.money.held).toBe("2380.00");
    expect(view?.money.safeToPay).toBe("59500.00");
  });

  it("7. we pay what is safe to pay, and not a dinar more than they are owed", async () => {
    await recordPayment({
      partyId: cheapId,
      direction: "out",
      method: "virement",
      amount: "59500.00",
      receivedOn: "2026-09-15",
      bankRef: "VIR OUT 2026-09-15",
      allocations: { [firstInvoiceId]: "59500.00" },
      actorId: ACTOR,
    });
    const [owed] = await payables({ partyId: cheapId });
    expect(owed?.paid).toBe("59500.00");

    // The balance is 2 380; allocating 5 000 is refused.
    await expect(
      recordPayment({
        partyId: cheapId,
        direction: "out",
        method: "virement",
        amount: "5000.00",
        receivedOn: "2026-09-16",
        allocations: { [firstInvoiceId]: "5000.00" },
        actorId: ACTOR,
      }),
    ).rejects.toBeInstanceOf(PaymentRefused);

    // A supplier invoice is not something a CLIENT payment can settle.
    await expect(
      recordPayment({
        partyId: cheapId,
        method: "virement",
        amount: "100.00",
        receivedOn: "2026-09-16",
        allocations: { [firstInvoiceId]: "100.00" },
        actorId: ACTOR,
      }),
    ).rejects.toThrow("noSuchInvoice");

    // Money we paid out is not money we hold unallocated.
    expect(Number(await unallocated(cheapId))).toBe(0);
    const view = await purchaseOrder(orderId);
    expect(view?.money.paid).toBe("59500.00");
    expect(view?.money.safeToPay).toBe("0.00");
  });

  it("8. the missing ten arrive; the quantity is explained, the price is still a question", async () => {
    const line = orderLines[0]?.id as string;
    const receiptId = await receiveGoods({
      orderId,
      quantities: { [line]: "10" },
      receivedOn: "2026-09-18",
      supplierRef: "BL 4502",
      receivedBy: "Magasin Adrar",
      reserves: "Conforme",
      actorId: ACTOR,
    });
    await render({ documentId: receiptId, purpose: "issue", actorId: ACTOR });

    const view = await purchaseOrder(orderId);
    expect(view?.receipts).toHaveLength(2);
    expect(view?.match.lines[0]).toMatchObject({ receivedQty: "40", state: "complete" });
    expect(view?.match.quantity.verdict).toBe("matches");
    expect(view?.match.held, "the 50 DA a unit nobody agreed to is still held").toBe("2000.00");
    expect(view?.blocks.find((b) => b.key === "invoiceInFull")?.state).toBe("ready");
    expect(view?.match.clean).toBe(false);
  });
});
