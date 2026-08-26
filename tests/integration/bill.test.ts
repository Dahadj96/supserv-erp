import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deliveryDetail } from "@/db/schema/delivery";
import { document, documentLine, documentLink } from "@/db/schema/document";
import { party, partyRole } from "@/db/schema/party";
import { billable, billFrom, CannotBill } from "@/documents/bill";
import { startDelivery } from "@/domain/delivery/store";

/**
 * Screen 72 — "4 of 9 order lines are delivered and signed. You can invoice
 * those now, or wait for the rest. Invoicing what is delivered is the faster
 * route to cash."
 *
 * ONE ORDER BECOMES SEVERAL FACTURES, which is the difference between this and
 * screen 48's conversion. Conversion is one document into one document and
 * refuses a second; billing is partial by nature and refuses only when there is
 * nothing left to bill.
 *
 * The subtraction that matters: billable under `delivered` is DELIVERED LESS
 * ALREADY INVOICED, not the lesser of the two. A line delivered 12 and invoiced
 * 12 has nothing left even though both figures are positive.
 */
const ACTOR = "test-bill-actor";
const stamp = Date.now().toString().slice(-5);

let clientId = "";
let orderId = "";
let lineIds: string[] = [];
const made: string[] = [];

beforeAll(async () => {
  const [client] = await db
    .insert(party)
    .values({ code: `CL-9${stamp}`, legalName: "TEST BILL BALADNA", tradeName: "BALADNA" })
    .returning({ id: party.id });
  clientId = client?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });

  const [order] = await db
    .insert(document)
    .values({
      kind: "proforma",
      number: `BIL/${stamp}/0046`,
      partyId: clientId,
      locale: "fr",
      status: "issued",
      issuedOn: "2026-08-01",
      totals: { totalExcl: "212000" },
    })
    .returning({ id: document.id });
  orderId = order?.id as string;

  const lines = await db
    .insert(documentLine)
    .values([
      {
        documentId: orderId,
        position: 1,
        lineKind: "item",
        designation: "Galets Ø108",
        unit: "U",
        qty: "40",
        unitPrice: "2980",
        vatRate: "19.00",
      },
      {
        documentId: orderId,
        position: 2,
        lineKind: "item",
        designation: "Roulements SKF 6308",
        unit: "U",
        qty: "24",
        unitPrice: "3900",
        vatRate: "19.00",
      },
    ])
    .returning({ id: documentLine.id });
  lineIds = lines.map((row) => row.id);
});

afterAll(async () => {
  const all = [orderId, ...made].filter(Boolean);
  await db.delete(deliveryDetail).where(inArray(deliveryDetail.documentId, all));
  await db.delete(documentLink).where(inArray(documentLink.fromDocument, all));
  await db.delete(documentLine).where(inArray(documentLine.documentId, all));
  await db.delete(document).where(inArray(document.id, all));
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  await db.delete(partyRole).where(eq(partyRole.partyId, clientId));
  await db.delete(party).where(eq(party.id, clientId));
});

describe("invoicing what has been delivered", () => {
  it("offers nothing under `delivered` while nothing has gone out", async () => {
    const rows = await billable({ sourceId: orderId, scope: "delivered" });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.billable === "0")).toBe(true);
    // ...and the whole order under `remaining`, because it is all still owed.
    const all = await billable({ sourceId: orderId, scope: "remaining" });
    expect(all.map((row) => row.billable)).toEqual(["40", "24"]);
  });

  it("refuses an invoice with nothing on it", async () => {
    await expect(
      billFrom({
        sourceId: orderId,
        quantities: {},
        invoiceDate: "2026-08-19",
        dueDate: null,
        actorId: ACTOR,
      }),
    ).rejects.toThrow(CannotBill);
  });

  it("offers what has gone out once a delivery note is issued", async () => {
    const bl = await startDelivery({
      sourceId: orderId,
      quantities: { [lineIds[0] as string]: "40", [lineIds[1] as string]: "12" },
      deliverOn: "2026-08-08",
      actorId: ACTOR,
    });
    made.push(bl);
    await db
      .update(document)
      .set({ number: `BLB-${stamp}-0118`, status: "issued" })
      .where(eq(document.id, bl));

    const rows = await billable({ sourceId: orderId, scope: "delivered" });
    expect(rows.map((row) => row.delivered)).toEqual(["40", "12"]);
    expect(rows.map((row) => row.billable)).toEqual(["40", "12"]);
  });

  it("raises a draft facture for the delivered quantities", async () => {
    const id = await billFrom({
      sourceId: orderId,
      quantities: { [lineIds[0] as string]: "40", [lineIds[1] as string]: "12" },
      invoiceDate: "2026-08-19",
      dueDate: "2026-09-18",
      actorId: ACTOR,
    });
    made.push(id);

    const [invoice] = await db.select().from(document).where(eq(document.id, id)).limit(1);
    expect(invoice?.kind).toBe("invoice");
    expect(invoice?.number).toBeNull();
    expect(invoice?.status).toBe("draft");

    // 40 × 2 980 + 12 × 3 900 = 119 200 + 46 800 = 166 000.
    const totals = invoice?.totals as { totalExcl: string };
    expect(totals.totalExcl).toBe("166000.00");
  });

  it("does not offer the same quantity twice", async () => {
    // The draft facture is not issued yet, so nothing has been billed...
    let rows = await billable({ sourceId: orderId, scope: "delivered" });
    expect(rows.map((row) => row.alreadyInvoiced)).toEqual(["0", "0"]);

    await db
      .update(document)
      .set({ number: `SUPB/${stamp}/0043`, status: "issued" })
      .where(eq(document.id, made[1] as string));

    // ...and once it is, those quantities are gone from what is billable.
    rows = await billable({ sourceId: orderId, scope: "delivered" });
    expect(rows.map((row) => row.alreadyInvoiced)).toEqual(["40", "12"]);
    expect(rows.map((row) => row.billable)).toEqual(["0", "0"]);
  });

  it("offers the second delivery, and only the second", async () => {
    const bl = await startDelivery({
      sourceId: orderId,
      quantities: { [lineIds[1] as string]: "12" },
      deliverOn: "2026-08-22",
      actorId: ACTOR,
    });
    made.push(bl);
    await db
      .update(document)
      .set({ number: `BLB-${stamp}-0124`, status: "issued" })
      .where(eq(document.id, bl));

    const rows = await billable({ sourceId: orderId, scope: "delivered" });
    // Delivered 24, invoiced 12, so 12 left — not min(24, 24 − 12) by accident
    // and not 24 because both figures are positive.
    expect(rows[1]).toMatchObject({ delivered: "24", alreadyInvoiced: "12", billable: "12" });
    expect(rows[0]?.billable).toBe("0");
  });

  it("bills the remainder onto a second facture, leaving the first alone", async () => {
    const id = await billFrom({
      sourceId: orderId,
      quantities: { [lineIds[1] as string]: "12" },
      invoiceDate: "2026-08-23",
      dueDate: null,
      actorId: ACTOR,
    });
    made.push(id);

    const [second] = await db.select().from(document).where(eq(document.id, id)).limit(1);
    expect((second?.totals as { totalExcl: string } | undefined)?.totalExcl).toBe("46800.00");

    // The first is untouched — it is issued, and an issued document is
    // immutable (LAW 5).
    const [first] = await db
      .select()
      .from(document)
      .where(eq(document.id, made[1] as string))
      .limit(1);
    expect(first?.number).toBe(`SUPB/${stamp}/0043`);
    expect((first?.totals as { totalExcl: string } | undefined)?.totalExcl).toBe("166000.00");

    // And the source has two factures against it, not one replacing the other.
    const links = await db.select().from(documentLink).where(eq(documentLink.toDocument, orderId));
    expect(links.filter((l) => l.relation === "covers")).toHaveLength(4);
  });

  it("records which screen raised it and that no number was handed out", async () => {
    const [entry] = await db
      .select()
      .from(auditEntry)
      .where(eq(auditEntry.entityId, made[1] as string))
      .limit(1);
    const after = entry?.after as Record<string, unknown>;
    expect(entry?.sourceScreen).toBe("72");
    expect(after?.numberReserved).toBe(false);
    expect(after?.sourceNumber).toBe(`BIL/${stamp}/0046`);
  });
});
