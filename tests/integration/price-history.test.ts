import { asc, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine, priceQuote } from "@/db/schema/deal";
import { document, documentLine } from "@/db/schema/document";
import { party, partyAlias, partyRole } from "@/db/schema/party";
import { render } from "@/documents/engine";
import { createDeal } from "@/domain/deal/deal";
import { replaceLines } from "@/domain/deal/lines";
import { priceHistory } from "@/domain/deal/price-history";
import { addQuote } from "@/domain/deal/price-store";
import { buildOffer } from "@/domain/offer/build";
import { createParty } from "@/domain/party";

/**
 * "What did this cost last time?" — asked of the database.
 *
 * June: a client asks for galets, a supplier quotes 4 000, the offer goes out
 * at 4 800. September: the same client asks for the same galets and nobody
 * has asked a supplier yet. The new offer must carry June's cost, say it did,
 * and screen 12 must be able to show June's price beside it.
 */
const ACTOR = "test-price-history-actor";
const GALET = "Galet de convoyeur Ø89 × 315 mm";

let clientId = "";
let juneDealId = "";
let juneOfferId = "";
let septemberDealId = "";

async function enquiry(subject: string, receivedAt: Date) {
  const id = await createDeal(
    {
      partyId: clientId,
      subject,
      contactPersonId: null,
      clientReference: null,
      receivedAt,
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
  await replaceLines({
    dealId: id,
    lines: [
      {
        position: 1,
        reference: "01",
        designation: GALET,
        qty: "10",
        unit: "U",
        readAs: "tabs",
        qtyAssumed: false,
      },
      {
        position: 2,
        reference: "02",
        designation: "Bague d'étanchéité 40x62x8",
        qty: "20",
        unit: "U",
        readAs: "tabs",
        qtyAssumed: false,
      },
    ],
    actorId: ACTOR,
  });
  const lines = await db
    .select()
    .from(dealLine)
    .where(eq(dealLine.dealId, id))
    .orderBy(asc(dealLine.position));
  return { id, lines };
}

beforeAll(async () => {
  const client = await createParty(
    {
      legalName: "ENAGEO ADRAR (TEST PRICE HISTORY)",
      tradeName: "",
      roles: ["client"],
      nif: "000116007654399",
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
  clientId = client.id;

  const june = await enquiry("Galets, juin", new Date("2026-06-02T08:00:00Z"));
  juneDealId = june.id;
  await addQuote({
    dealId: juneDealId,
    dealLineId: june.lines[0]?.id ?? null,
    currency: "DZD",
    isExclVat: true,
    isVerbal: false,
    validUntil: null,
    capturedPlace: null,
    capturedFrom: null,
    source: "supplier_email",
    supplierName: "FOURNISSEUR ROULEMENTS (TEST PRICE HISTORY)",
    price: "4000",
    actorId: ACTOR,
  });
  juneOfferId = await buildOffer({
    dealId: juneDealId,
    kind: "proforma",
    defaultMarginPct: "20",
    actorId: ACTOR,
  });
  await render({ documentId: juneOfferId, purpose: "issue", actorId: ACTOR });

  const september = await enquiry("Galets, septembre", new Date("2026-09-04T08:00:00Z"));
  septemberDealId = september.id;
});

afterAll(async () => {
  const parties = await db
    .select({ id: party.id })
    .from(party)
    .where(like(party.legalName, "% (TEST PRICE HISTORY)"));
  const partyIds = parties.map((p) => p.id);
  if (partyIds.length > 0) {
    const docs = await db
      .select({ id: document.id })
      .from(document)
      .where(inArray(document.partyId, partyIds));
    const docIds = docs.map((d) => d.id);
    if (docIds.length > 0) {
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
    await db.delete(priceQuote).where(inArray(priceQuote.partyId, partyIds));
    await db.delete(partyRole).where(inArray(partyRole.partyId, partyIds));
    await db.delete(partyAlias).where(inArray(partyAlias.partyId, partyIds));
    await db.delete(party).where(inArray(party.id, partyIds));
  }
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
});

describe("priceHistory", () => {
  it("finds June's sale and June's supplier price from the wording alone", async () => {
    const h = await priceHistory(GALET, { partyId: clientId });
    expect(h.sold).toHaveLength(1);
    expect(h.sold[0]).toMatchObject({
      documentId: juneOfferId,
      kind: "proforma",
      unitPrice: "4800.0000",
      unitCost: "4000.0000",
      sameClient: true,
    });
    expect(h.sold[0]?.number).toMatch(/^PF-|^AZPF-/);
    expect(h.bought).toHaveLength(1);
    expect(h.bought[0]).toMatchObject({ price: "4000.0000", isVerbal: false });
    expect(h.bought[0]?.supplier).toContain("FOURNISSEUR ROULEMENTS");
  });

  it("finds it with the wording typed differently — no accents, no Ø", async () => {
    const h = await priceHistory("galet convoyeur 89 315");
    expect(h.sold.map((s) => s.documentId)).toContain(juneOfferId);
  });

  it("does not confuse the galet with the bague, and leaves the offer being priced out", async () => {
    const bague = await priceHistory("Bague d'étanchéité 40x62x8");
    // June's bague had no cost and therefore no price: nothing sold.
    expect(bague.sold).toHaveLength(0);
    const excluded = await priceHistory(GALET, { excludeDocumentId: juneOfferId });
    expect(excluded.sold).toHaveLength(0);
  });
});

describe("the September offer", () => {
  it("carries June's cost, says it came from a previous offer, and prices from it", async () => {
    const offerId = await buildOffer({
      dealId: septemberDealId,
      kind: "proforma",
      defaultMarginPct: "25",
      actorId: ACTOR,
    });
    const lines = await db
      .select()
      .from(documentLine)
      .where(eq(documentLine.documentId, offerId))
      .orderBy(asc(documentLine.position));

    expect(lines[0]).toMatchObject({
      unitCost: "4000.0000",
      costSource: "previous_offer",
      costQuoteId: null,
      unitPrice: "5000.0000",
    });
    // The bague had no history: no cost, no price, and nothing invented.
    expect(lines[1]?.unitCost).toBeNull();
    expect(lines[1]?.unitPrice).toBeNull();
  });
});
