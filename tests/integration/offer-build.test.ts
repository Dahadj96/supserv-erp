import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine, priceQuote } from "@/db/schema/deal";
import { document, documentLine } from "@/db/schema/document";
import { party, partyRole } from "@/db/schema/party";
import { sourcingRequest } from "@/db/schema/sourcing";
import { createDeal } from "@/domain/deal/deal";
import { replaceLines } from "@/domain/deal/lines";
import { parsePaste } from "@/domain/deal/paste";
import { addQuote } from "@/domain/deal/price-store";
import { createRequest, markSent, recordAnswer } from "@/domain/deal/sourcing-store";
import { BuildRefused, buildOffer } from "@/domain/offer/build";
import { marginPct, summariseMargin } from "@/domain/offer/margin";

/**
 * Phase 4's done-criteria, end to end:
 *
 *   "an RFQ with items pasted from an email body reaches a sent offer with a
 *    complete annexe technique, and every price says where it came from."
 *
 * The annexe is screens 77 and 78 and is not built yet. Everything else in that
 * sentence is exercised here in one go, because the value of this phase is the
 * JOIN between its parts, and each part passing alone proves nothing about it.
 */
const ACTOR = "test-offerbuild-actor";
const stamp = Date.now().toString().slice(-5);

let clientId = "";
let supplierId = "";
let shopId = "";
let dealId = "";
const documents: string[] = [];

const RFQ = `Bonjour,

Merci de nous faire parvenir votre offre pour :

1. VP-DN80-16 Vanne papillon DN80 PN16, corps fonte — 12 pc
2. RAC-BR-2 Raccord bride 2" acier galvanisé — 40 pc
3. Installation et mise en service

Cordialement`;

beforeAll(async () => {
  const [client] = await db
    .insert(party)
    .values({ code: `CL-T7${stamp}`, legalName: "TEST OB CLIENT", nif: "000116001234567" })
    .returning({ id: party.id });
  clientId = client?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });

  const [supplier] = await db
    .insert(party)
    .values({ code: `SU-T7${stamp}`, legalName: "TEST OB HYDRO" })
    .returning({ id: party.id });
  supplierId = supplier?.id as string;
  await db.insert(partyRole).values({ partyId: supplierId, role: "supplier" });

  dealId = await createDeal(
    {
      partyId: clientId,
      subject: "Vannes et raccords",
      contactPersonId: null,
      clientReference: "25/DA/2026",
      receivedAt: new Date(),
      deadlineAt: new Date(Date.UTC(2026, 7, 20, 12)),
      submissionMethod: "deposit_sealed",
      currency: "DZD",
      ownerId: null,
      source: "manual",
      intakeMessageId: null,
      expectedValue: null,
      clientInstructions: null,
    },
    ACTOR,
  );
});

afterAll(async () => {
  if (documents.length) {
    await db.delete(documentLine).where(inArray(documentLine.documentId, documents));
    await db.delete(document).where(inArray(document.id, documents));
  }
  await db.delete(priceQuote).where(eq(priceQuote.dealId, dealId));
  await db.delete(sourcingRequest).where(eq(sourcingRequest.dealId, dealId));
  await db.delete(dealLine).where(eq(dealLine.dealId, dealId));
  await db.delete(deal).where(eq(deal.id, dealId));
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  const all = [clientId, supplierId, shopId].filter(Boolean);
  await db.delete(partyRole).where(inArray(partyRole.partyId, all));
  await db.delete(party).where(inArray(party.id, all));
});

describe("an email becomes an offer", () => {
  it("refuses to build from an enquiry with no lines", async () => {
    await expect(buildOffer({ dealId, actorId: ACTOR })).rejects.toThrow(BuildRefused);
  });

  it("turns the pasted list into lines, keeping the client's references", async () => {
    const read = parsePaste(RFQ);
    expect(read.lines).toHaveLength(3);
    await replaceLines({ dealId, lines: read.lines, actorId: ACTOR });

    const rows = await db
      .select()
      .from(dealLine)
      .where(eq(dealLine.dealId, dealId))
      .orderBy(dealLine.position);
    expect(rows.map((r) => r.reference)).toEqual(["VP-DN80-16", "RAC-BR-2", null]);
    // Line 3 is a service. No reference, quantity assumed as one.
    expect(rows[2]?.designation).toBe("Installation et mise en service");
  });

  it("carries a supplier's answer onto the offer as the cost", async () => {
    const lines = await db
      .select()
      .from(dealLine)
      .where(eq(dealLine.dealId, dealId))
      .orderBy(dealLine.position);

    const requestId = await createRequest({
      dealId,
      subject: "Vannes",
      supplierIds: [supplierId],
      actorId: ACTOR,
    });
    await markSent({ requestId, actorId: ACTOR });

    const [response] = await db
      .select({ id: sourcingRequest.id })
      .from(sourcingRequest)
      .where(eq(sourcingRequest.id, requestId));
    expect(response).toBeTruthy();

    const { requestFor } = await import("@/domain/deal/sourcing-store");
    const found = await requestFor(requestId);
    await recordAnswer({
      responseId: found?.answers[0]?.responseId as string,
      status: "quoted",
      validityDays: 90,
      leadTimeDays: 21,
      prices: {
        [lines[0]?.id as string]: "38400",
        [lines[1]?.id as string]: "2610",
      },
      actorId: ACTOR,
    });

    // A price from a counter, for the line nobody was asked about. It is a
    // service, so in real life this would be an internal costing — here it
    // proves the fallback path from `price_quote`.
    const shop = await addQuote({
      dealId,
      dealLineId: lines[2]?.id as string,
      source: "shop_visit",
      supplierName: "TEST OB ETS CHERGUI",
      price: "35000",
      currency: "DZD",
      isExclVat: true,
      isVerbal: true,
      validUntil: null,
      capturedPlace: "Adrar centre",
      capturedFrom: "M. Chergui",
      actorId: ACTOR,
    });
    expect(shop).toBeTruthy();

    const [created] = await db
      .select({ id: party.id })
      .from(party)
      .where(eq(party.legalName, "TEST OB ETS CHERGUI"));
    shopId = created?.id as string;

    const offerId = await buildOffer({ dealId, defaultMarginPct: "20", actorId: ACTOR });
    documents.push(offerId);

    const offerLines = await db
      .select()
      .from(documentLine)
      .where(eq(documentLine.documentId, offerId))
      .orderBy(documentLine.position);

    expect(offerLines).toHaveLength(3);
    expect(offerLines.map((l) => l.unitCost)).toEqual(["38400.0000", "2610.0000", "35000.0000"]);
    // Every price says where it came from.
    expect(offerLines.every((l) => l.costSource === "supplier_quote")).toBe(true);
    // The two from sourcing have no quote id; the one from a counter does.
    expect(offerLines[0]?.costQuoteId).toBeNull();
    expect(offerLines[2]?.costQuoteId).toBeTruthy();
  });
});

describe("what the built offer is, and is not", () => {
  it("takes no number, because a number is allocated at issue", async () => {
    const [offer] = await db
      .select()
      .from(document)
      .where(eq(document.id, documents[0] as string));
    // LAW 5, and screen 12's Numbering card in as many words:
    // "Reserved — No, assigned on send."
    expect(offer?.number).toBeNull();
    expect(offer?.status).toBe("draft");
    // And it knows which enquiry it answers, which is what screen 05's derived
    // stage reads. A draft does not move the stage — it has no number.
    expect(offer?.dealId).toBe(dealId);
  });

  it("prices every costed line at the margin asked for", async () => {
    const lines = await db
      .select()
      .from(documentLine)
      .where(eq(documentLine.documentId, documents[0] as string));

    for (const line of lines) {
      expect(marginPct(line.unitCost, line.unitPrice)).toBe("20.00");
    }
  });

  it("records how many lines arrived with a real cost behind them", async () => {
    const [entry] = await db
      .select()
      .from(auditEntry)
      .where(eq(auditEntry.entityId, documents[0] as string));

    const after = entry?.after as { linesWithCost?: number; numberReserved?: boolean };
    expect(after?.linesWithCost).toBe(3);
    expect(after?.numberReserved).toBe(false);
    expect(entry?.sourceScreen).toBe("12");
  });

  it("summarises a margin that agrees with the lines", async () => {
    const lines = await db
      .select()
      .from(documentLine)
      .where(eq(documentLine.documentId, documents[0] as string));

    const summary = summariseMargin(
      lines.map((l) => ({
        unitCost: l.unitCost,
        unitPrice: l.unitPrice,
        qty: l.qty,
        isOption: l.isOption,
        lineKind: l.lineKind,
      })),
    );

    // 460 800 + 104 400 + 35 000 = 600 200 of cost, at 20%.
    expect(summary.totalCost).toBe("600200.00");
    expect(summary.marginPct).toBe("20.0");
    expect(summary.linesWithoutCost).toBe(0);
  });

  it("leaves a line with no cost unpriced rather than inventing one", async () => {
    const lines = await db
      .select()
      .from(dealLine)
      .where(eq(dealLine.dealId, dealId))
      .orderBy(dealLine.position);

    await db.insert(dealLine).values({
      dealId,
      position: lines.length + 1,
      designation: "Formation du personnel",
      qty: "1",
    });

    const offerId = await buildOffer({ dealId, defaultMarginPct: "20", actorId: ACTOR });
    documents.push(offerId);

    const built = await db
      .select()
      .from(documentLine)
      .where(eq(documentLine.documentId, offerId))
      .orderBy(documentLine.position);

    const orphan = built[built.length - 1];
    expect(orphan?.designation).toBe("Formation du personnel");
    // Still on the offer — it is what the client asked for. With no cost, no
    // price, and no invented figure sitting in the Cost column looking found.
    expect(orphan?.unitCost).toBeNull();
    expect(orphan?.unitPrice).toBeNull();
    expect(orphan?.costSource).toBeNull();
  });
});
