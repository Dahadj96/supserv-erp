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
import { project, situationDetail } from "@/db/schema/project";
import { billable, billFrom, CannotBill } from "@/documents/bill";
import { ensureRulesExist } from "@/documents/compliance";
import { CannotConvert, convertDocument } from "@/documents/convert";
import { render } from "@/documents/engine";
import { toPdf } from "@/documents/pdf";
import { saveIdentity, setLogo } from "@/domain/company";
import { createDeal, factsFor } from "@/domain/deal/deal";
import { replaceLines } from "@/domain/deal/lines";
import { addQuote } from "@/domain/deal/price-store";
import { CannotDeliver, recordSignedCopy, startDelivery } from "@/domain/delivery/store";
import { ensureTypesExist } from "@/domain/document-types";
import { owings, recordPayment } from "@/domain/money/store";
import { buildOffer } from "@/domain/offer/build";
import { markSubmitted } from "@/domain/offer/store";
import { createParty } from "@/domain/party";

/** Intl uses a narrow no-break space in French, which is correct typography. */
const spaces = (s: string | undefined) => (s ?? "").replace(/[\u202F\u00A0]/g, " ");

async function pdfText(bytes: Buffer): Promise<string> {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), {
    mergePages: true,
  });
  return spaces(text);
}

/**
 * A to Z — one enquiry, walked the way a person walks it.
 *
 * Client → enquiry → supplier prices → offer → issued → the client says yes →
 * their order → a first lorry → an invoice for what went → paid → the rest.
 * Every step is the function the screen calls, in the order the screens are
 * reached, with the company's real identity on the letterhead.
 *
 * This file exists because reading the screens one by one found three holes
 * a single walk shows at once: an offer priced on screen 12 reached the PDF
 * with "Total HT 0,00"; nothing could turn an offer into the client's order,
 * so no enquiry could ever be won; and a client's order, which carries THEIR
 * number, could not be delivered or billed against because both checked for
 * one of ours.
 */
const ACTOR = "test-a-to-z-actor";
const SERIES = ["proforma", "delivery_note", "invoice"] as const;

/** The letterhead, as day one filled it in. */
const IDENTITY = {
  legalName: "SARL SUPSERV",
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
let dealId: string;
let offerId: string;
let orderId: string;
let firstBlId: string;
let firstInvoiceId: string;
let orderLines: { id: string; designation: string | null }[] = [];

const stored = async (id: string) =>
  (await db.select().from(document).where(eq(document.id, id)))[0] as typeof document.$inferSelect;
const totalsOf = async (id: string) =>
  (await stored(id)).totals as { totalExcl: string; totalVat: string; totalIncl: string };

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
    { kind: "proforma", pattern: "AZPF-{YYYY}-{####}", reset: "yearly", nextValue: 1 },
    { kind: "delivery_note", pattern: "AZBL-{YYYY}-{####}", reset: "yearly", nextValue: 1 },
    { kind: "invoice", pattern: "AZFA-{YYYY}-{####}", reset: "yearly", nextValue: 1 },
  ]);

  await db.delete(vatRate).where(like(vatRate.authority, "TESTAZ %"));
  await db.insert(vatRate).values({
    rate: "19.000",
    kind: "normal",
    startsOn: "2017-01-01",
    authority: "TESTAZ CTCA art. 21",
  });
});

afterAll(async () => {
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

    await db
      .delete(paymentAllocation)
      .where(
        inArray(
          paymentAllocation.paymentId,
          db.select({ id: payment.id }).from(payment).where(inArray(payment.partyId, partyIds)),
        ),
      );
    await db.delete(payment).where(inArray(payment.partyId, partyIds));

    // Projects BEFORE documents. `project.contract_document_id` points at the
    // issued order a project bills against, so a document cannot be deleted
    // while a project names it — and `scripts/lib/walk-fixture.ts` seeds a
    // project on parties with these same names, into this same database.
    const walkDeals = await db
      .select({ id: deal.id })
      .from(deal)
      .where(inArray(deal.partyId, partyIds));
    if (walkDeals.length > 0) {
      const projects = await db
        .select({ id: project.id })
        .from(project)
        .where(
          inArray(
            project.dealId,
            walkDeals.map((d) => d.id),
          ),
        );
      if (projects.length > 0) {
        const ids = projects.map((p) => p.id);
        await db.delete(situationDetail).where(inArray(situationDetail.projectId, ids));
        await db.delete(project).where(inArray(project.id, ids));
      }
    }

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
  await db.delete(vatRate).where(like(vatRate.authority, "TESTAZ %"));
  if (previousIdentity) {
    await db
      .update(companyIdentity)
      .set(previousIdentity)
      .where(eq(companyIdentity.id, COMPANY_ID));
  } else {
    await db.delete(companyIdentity).where(eq(companyIdentity.id, COMPANY_ID));
  }
});

describe("A to Z — enquiry to cash, the way a person walks it", () => {
  it("1. the client is on file", async () => {
    const created = await createParty(
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
      ACTOR,
    );
    clientId = created.id;
    expect(created.code).toMatch(/^CL-\d+$/);
  });

  it("2. their enquiry arrives, with the lines they asked for", async () => {
    dealId = await createDeal(
      {
        partyId: clientId,
        subject: "Fourniture de galets de convoyeur",
        contactPersonId: null,
        clientReference: "DA 2026/118",
        receivedAt: new Date("2026-09-01T08:00:00Z"),
        deadlineAt: null,
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

    const n = await replaceLines({
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
      actorId: ACTOR,
    });
    expect(n).toBe(2);
  });

  it("3. a supplier price and an internal costing are captured against the lines", async () => {
    const lines = await db
      .select()
      .from(dealLine)
      .where(eq(dealLine.dealId, dealId))
      .orderBy(asc(dealLine.position));

    await addQuote({
      dealId,
      dealLineId: lines[0]?.id ?? null,
      source: "supplier_email",
      supplierName: "FOURNISSEUR ROULEMENTS (TEST A-Z)",
      price: "4 000,00",
      currency: "DZD",
      isExclVat: true,
      isVerbal: false,
      validUntil: null,
      capturedPlace: null,
      capturedFrom: null,
      actorId: ACTOR,
    });
    await addQuote({
      dealId,
      dealLineId: lines[1]?.id ?? null,
      source: "internal_costing",
      supplierName: null,
      price: "1500",
      currency: "DZD",
      isExclVat: true,
      isVerbal: false,
      validUntil: null,
      capturedPlace: null,
      capturedFrom: null,
      actorId: ACTOR,
    });
  });

  it("4. the offer is built at 20 % and its totals are the sum of its lines", async () => {
    offerId = await buildOffer({
      dealId,
      kind: "proforma",
      defaultMarginPct: "20",
      actorId: ACTOR,
    });

    // 4 000 + 20 % = 4 800 × 10 = 48 000; 1 500 + 20 % = 1 800 × 1. 49 800 HT,
    // 9 462 TVA, 59 262 TTC. This is the figure screen 12 shows — and the one
    // the PDF used to print as nought, because nothing summed the lines.
    const totals = await totalsOf(offerId);
    expect(totals.totalExcl).toBe("49800.00");
    expect(totals.totalVat).toBe("9462.00");
    expect(totals.totalIncl).toBe("59262.00");

    const lines = await db
      .select()
      .from(documentLine)
      .where(eq(documentLine.documentId, offerId))
      .orderBy(asc(documentLine.position));
    expect(lines.map((l) => l.totalExcl)).toEqual(["48000.00", "1800.00"]);
    expect(lines[0]?.costSource).toBe("supplier_quote");
  });

  it("5. the proforma previews and issues with the real letterhead and a real total", async () => {
    const preview = await render({ documentId: offerId, purpose: "preview", actorId: ACTOR });
    expect(preview.number).toBeNull();
    expect(preview.issued).toBe(false);
    expect(preview.company.rc).toBe(IDENTITY.rc);
    expect(spaces(preview.totals.find((t) => t.label === "totalIncl")?.value)).toBe("59 262,00");

    const out = await render({ documentId: offerId, purpose: "issue", actorId: ACTOR });
    expect(out.number).toMatch(/^AZPF-\d{4}-0001$/);
    expect(out.issued).toBe(true);
    const text = await pdfText(await toPdf(out));
    expect(text).toContain("SARL SUPSERV");
    expect(text).toContain("59 262,00");
    expect(text).toContain("cinquante-neuf mille deux cent soixante-deux dinars");
    expect(text).not.toContain("BROUILLON");

    await markSubmitted({
      offerId,
      place: "email",
      proofRef: null,
      when: new Date("2026-09-02T09:00:00Z"),
      actorId: ACTOR,
    });
    const facts = (await factsFor([dealId])).get(dealId);
    expect(facts?.offersIssued).toBe(1);
    expect(facts?.ordersReceived).toBe(0);
  });

  it("6. the client says yes — their order is recorded from the offer, under their number", async () => {
    orderId = await convertDocument({
      documentId: offerId,
      target: "client_order",
      invoiceDate: "2026-09-03",
      dueDate: null,
      paymentMethod: null,
      settlement: "virement",
      clientReference: "BC 2026/0457",
      actorId: ACTOR,
    });

    const order = await stored(orderId);
    expect(order.kind).toBe("client_order");
    expect(order.number, "their number, from the day it arrives").toBe("BC 2026/0457");
    expect(order.status).toBe("draft");
    expect(order.dealId).toBe(dealId);
    expect(order.settlement, "screen 48's answer, not the proforma's").toBe("virement");
    expect((await totalsOf(orderId)).totalIncl).toBe("59262.00");

    // Still a draft: not yet a win.
    expect((await factsFor([dealId])).get(dealId)?.ordersReceived).toBe(0);

    // Recording it is issuing it — no number of ours is taken.
    const out = await render({ documentId: orderId, purpose: "issue", actorId: ACTOR });
    expect(out.number).toBe("BC 2026/0457");
    expect(out.issued).toBe(true);
    expect((await stored(orderId)).status).toBe("issued");
    expect((await factsFor([dealId])).get(dealId)?.ordersReceived, "won").toBe(1);

    // The proforma was not touched, and cannot be converted a second time.
    expect((await stored(offerId)).number).toMatch(/^AZPF-/);
    await expect(
      convertDocument({
        documentId: offerId,
        target: "invoice",
        invoiceDate: "2026-09-03",
        dueDate: null,
        paymentMethod: null,
        actorId: ACTOR,
      }),
    ).rejects.toBeInstanceOf(CannotConvert);

    orderLines = await db
      .select({ id: documentLine.id, designation: documentLine.designation })
      .from(documentLine)
      .where(eq(documentLine.documentId, orderId))
      .orderBy(asc(documentLine.position));
    expect(orderLines).toHaveLength(2);
  });

  it("7. nothing can be delivered or billed against the draft it was", async () => {
    // A second order draft from a hypothetical: the offer is spent, so use the
    // rule directly — a draft source is refused by both doors.
    const [draft] = await db
      .insert(document)
      .values({
        kind: "client_order",
        partyId: clientId,
        dealId,
        locale: "fr",
        currency: "DZD",
        status: "draft",
        number: "BC DRAFT",
        totals: {},
      })
      .returning({ id: document.id });
    const draftId = draft?.id as string;
    await db.insert(documentLine).values({
      documentId: draftId,
      position: 1,
      lineKind: "item",
      designation: "x",
      qty: "1",
      unitPrice: "1",
      vatRate: "19",
    });
    const [line] = await db
      .select({ id: documentLine.id })
      .from(documentLine)
      .where(eq(documentLine.documentId, draftId));

    await expect(
      startDelivery({
        sourceId: draftId,
        quantities: { [line?.id as string]: "1" },
        deliverOn: "2026-09-04",
        actorId: ACTOR,
      }),
    ).rejects.toBeInstanceOf(CannotDeliver);
    await expect(
      billFrom({
        sourceId: draftId,
        quantities: { [line?.id as string]: "1" },
        invoiceDate: "2026-09-04",
        dueDate: null,
        actorId: ACTOR,
      }),
    ).rejects.toBeInstanceOf(CannotBill);
  });

  it("8. the first lorry: six of ten go out on a BL, and the signed copy comes back", async () => {
    const galets = orderLines[0]?.id as string;
    firstBlId = await startDelivery({
      sourceId: orderId,
      quantities: { [galets]: "6" },
      deliverOn: "2026-09-05",
      actorId: ACTOR,
    });
    const out = await render({ documentId: firstBlId, purpose: "issue", actorId: ACTOR });
    expect(out.number).toMatch(/^AZBL-\d{4}-0001$/);
    // A BL carries no money.
    expect(out.totals).toEqual([]);

    await recordSignedCopy({
      documentId: firstBlId,
      receivedBy: "M. Benali, magasinier",
      receivedOn: "2026-09-05",
      reserves: null,
      actorId: ACTOR,
    });
  });

  it("9. invoice what is delivered: six galets, nothing else", async () => {
    const rows = await billable({ sourceId: orderId, scope: "delivered" });
    expect(rows.map((r) => [r.ordered, r.delivered, r.billable])).toEqual([
      ["10.0000", "6", "6"],
      ["1.0000", "0", "0"],
    ]);

    const galets = orderLines[0]?.id as string;
    firstInvoiceId = await billFrom({
      sourceId: orderId,
      quantities: { [galets]: "6" },
      invoiceDate: "2026-09-06",
      dueDate: "2026-10-06",
      actorId: ACTOR,
    });

    // 6 × 4 800 = 28 800 HT, 5 472 TVA, 34 272 TTC. Settled by transfer, so no
    // droit de timbre whatever the accountant has confirmed.
    const invoice = await stored(firstInvoiceId);
    expect(invoice.settlement).toBe("virement");
    expect(invoice.stampDuty).toBe("0.00");
    expect((await totalsOf(firstInvoiceId)).totalIncl).toBe("34272.00");

    const out = await render({ documentId: firstInvoiceId, purpose: "issue", actorId: ACTOR });
    expect(out.number).toMatch(/^AZFA-\d{4}-0001$/);
    const text = await pdfText(await toPdf(out));
    expect(text).toContain("34 272,00");
    expect(text).toContain("Mode de règlement");
    expect(text).toContain("Virement bancaire");
    expect(text).toContain(IDENTITY.nif);
    expect(text).toContain("000116007654321");

    // The remaining four are still there to bill, and only four.
    const after = await billable({ sourceId: orderId, scope: "remaining" });
    expect(after.map((r) => [r.alreadyInvoiced, r.billable])).toEqual([
      ["6", "4"],
      ["0", "1"],
    ]);
  });

  it("10. the client pays the first invoice by transfer, and the ledger agrees", async () => {
    const before = await owings({ partyId: clientId });
    expect(before).toHaveLength(1);
    expect(before[0]?.totalIncl).toBe("34272.00");
    expect(Number(before[0]?.paid)).toBe(0);

    await recordPayment({
      partyId: clientId,
      method: "virement",
      amount: "34272.00",
      receivedOn: "2026-09-20",
      bankRef: "VIR 2026-09-20 ENAGEO",
      allocations: { [firstInvoiceId]: "34272.00" },
      actorId: ACTOR,
    });

    const after = await owings({ partyId: clientId });
    expect(Number(after[0]?.paid)).toBe(34272);
  });

  it("11. the rest goes out and is billed — the order is then fully invoiced", async () => {
    const [galets, transport] = orderLines.map((l) => l.id);
    const bl = await startDelivery({
      sourceId: orderId,
      quantities: { [galets as string]: "4", [transport as string]: "1" },
      deliverOn: "2026-09-25",
      actorId: ACTOR,
    });
    await render({ documentId: bl, purpose: "issue", actorId: ACTOR });

    const invoiceId = await billFrom({
      sourceId: orderId,
      quantities: { [galets as string]: "4", [transport as string]: "1" },
      invoiceDate: "2026-09-26",
      dueDate: "2026-10-26",
      actorId: ACTOR,
    });
    // 4 × 4 800 + 1 800 = 21 000 HT → 24 990 TTC. 34 272 + 24 990 = 59 262:
    // the two factures add up to the proforma the client accepted.
    expect((await totalsOf(invoiceId)).totalIncl).toBe("24990.00");
    const out = await render({ documentId: invoiceId, purpose: "issue", actorId: ACTOR });
    expect(out.number).toMatch(/^AZFA-\d{4}-0002$/);

    const left = await billable({ sourceId: orderId, scope: "remaining" });
    expect(left.every((r) => r.billable === "0")).toBe(true);
    await expect(
      billFrom({
        sourceId: orderId,
        quantities: {},
        invoiceDate: "2026-09-27",
        dueDate: null,
        actorId: ACTOR,
      }),
    ).rejects.toBeInstanceOf(CannotBill);

    const facts = (await factsFor([dealId])).get(dealId);
    expect(facts).toMatchObject({ offersIssued: 1, ordersReceived: 1, invoicesIssued: 2 });
  });
});
