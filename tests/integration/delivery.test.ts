import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deliveryDetail } from "@/db/schema/delivery";
import { document, documentLine, documentLink } from "@/db/schema/document";
import { party, partyRole } from "@/db/schema/party";
import { mayDeliverAgainst, progress } from "@/domain/delivery/lines";
import {
  CannotDeliver,
  coveredAgainst,
  deliveries,
  deliveryLines,
  detailFor,
  recordSignedCopy,
  sourceLines,
  sourceOf,
  startDelivery,
} from "@/domain/delivery/store";

/**
 * Screens 49 and 14, against a real database.
 *
 * The assertion that carries the design: a DRAFT bon de livraison has delivered
 * nothing. The lorry has not left, and counting it would let somebody invoice
 * goods still in the warehouse.
 */
const ACTOR = "test-delivery-actor";
const stamp = Date.now().toString().slice(-5);

let clientId = "";
let orderId = "";
let lineIds: string[] = [];
const notes: string[] = [];
/**
 * Documents made by one test and read by no other.
 *
 * `notes` is indexed positionally further down — `notes[1]` is "the first bon
 * de livraison" — so anything pushed into it by a new test in the middle
 * silently renumbers every assertion after it. That cost six red tests once.
 */
const extra: string[] = [];

beforeAll(async () => {
  const [client] = await db
    .insert(party)
    .values({ code: `CL-T8${stamp}`, legalName: "TEST DEL BALADNA", tradeName: "BALADNA ALGERIA" })
    .returning({ id: party.id });
  clientId = client?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });

  const [order] = await db
    .insert(document)
    .values({
      kind: "proforma",
      number: `DEL/${stamp}/0046`,
      partyId: clientId,
      locale: "fr",
      status: "issued",
      issuedOn: "2026-08-01",
      totals: { totalExcl: "1120000" },
    })
    .returning({ id: document.id });
  orderId = order?.id as string;

  const made = await db
    .insert(documentLine)
    .values([
      {
        documentId: orderId,
        position: 1,
        lineKind: "item",
        designation: "Galets de convoyeur Ø108",
        unit: "U",
        qty: "40",
        unitPrice: "2980",
      },
      {
        documentId: orderId,
        position: 2,
        lineKind: "item",
        designation: "Roulements SKF 6308",
        unit: "U",
        qty: "24",
        unitPrice: "3900",
      },
    ])
    .returning({ id: documentLine.id });
  lineIds = made.map((row) => row.id);
});

afterAll(async () => {
  const all = [orderId, ...notes, ...extra].filter(Boolean);
  await db.delete(deliveryDetail).where(inArray(deliveryDetail.documentId, [...notes, ...extra]));
  await db.delete(documentLink).where(inArray(documentLink.fromDocument, all));
  await db.delete(documentLine).where(inArray(documentLine.documentId, all));
  await db.delete(document).where(inArray(document.id, all));
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  await db.delete(partyRole).where(eq(partyRole.partyId, clientId));
  await db.delete(party).where(eq(party.id, clientId));
});

const ours = async () => (await deliveries({ sourceId: orderId })).filter((row) => row);

describe("recording a delivery", () => {
  it("refuses to deliver against something the client never agreed to", async () => {
    const [draft] = await db
      .insert(document)
      .values({
        kind: "proforma",
        number: null,
        partyId: clientId,
        locale: "fr",
        status: "draft",
        totals: {},
      })
      .returning({ id: document.id });
    notes.push(draft?.id as string);

    await expect(
      startDelivery({
        sourceId: draft?.id as string,
        quantities: { [lineIds[0] as string]: "1" },
        deliverOn: "2026-08-08",
        actorId: ACTOR,
      }),
    ).rejects.toThrow(CannotDeliver);
  });

  it("refuses to deliver against a bon de livraison, whatever the id in the URL says", async () => {
    // The button on screen 18 was the only thing asking about the kind, and
    // `/deliveries/new?source=<id>` took whatever it was given — so a BL
    // against a BL was one typed URL away, and `startDelivery` checked the
    // state and never the kind.
    const [bl] = await db
      .insert(document)
      .values({
        kind: "delivery_note",
        number: `BL-${stamp}-9001`,
        partyId: clientId,
        locale: "fr",
        status: "issued",
        issuedOn: "2026-08-05",
        totals: {},
      })
      .returning({ id: document.id });
    extra.push(bl?.id as string);

    await expect(
      startDelivery({
        sourceId: bl?.id as string,
        quantities: { [lineIds[0] as string]: "1" },
        deliverOn: "2026-08-08",
        actorId: ACTOR,
      }),
    ).rejects.toMatchObject({ why: "sourceNotDeliverable" });
  });

  it("delivers against the client's own bon de commande — the kind the button did not offer", async () => {
    // `client_order` is what winning looks like (`ORDER_KINDS` in
    // domain/deal/deal.ts) and what the conversion module says deliveries
    // should hang off. It was the one sell-side kind missing from the list.
    expect(mayDeliverAgainst("client_order")).toBe(true);

    const [order] = await db
      .insert(document)
      .values({
        // Their number, not ours: a bon de commande client carries the
        // client's reference and no series of ours is allocated.
        kind: "client_order",
        number: `BC/CLIENT/${stamp}`,
        partyId: clientId,
        locale: "fr",
        status: "issued",
        issuedOn: "2026-08-02",
        totals: { totalExcl: "119200" },
      })
      .returning({ id: document.id });
    const orderDocId = order?.id as string;
    extra.push(orderDocId);

    const [line] = await db
      .insert(documentLine)
      .values({
        documentId: orderDocId,
        position: 1,
        lineKind: "item",
        designation: "Galets de convoyeur Ø108",
        unit: "U",
        qty: "40",
        unitPrice: "2980",
      })
      .returning({ id: documentLine.id });

    const id = await startDelivery({
      sourceId: orderDocId,
      quantities: { [line?.id as string]: "10" },
      deliverOn: "2026-08-09",
      actorId: ACTOR,
    });
    extra.push(id);

    const [made] = await db.select().from(document).where(eq(document.id, id)).limit(1);
    expect(made?.kind).toBe("delivery_note");
    expect(made?.number, "a draft carries no number — LAW 5").toBeNull();

    const [covers] = await sourceOf(id);
    expect(covers?.id).toBe(orderDocId);
    expect(covers?.number, "their reference, kept verbatim").toBe(`BC/CLIENT/${stamp}`);
  });

  it("refuses a delivery of nothing", async () => {
    await expect(
      startDelivery({
        sourceId: orderId,
        quantities: { [lineIds[0] as string]: "0" },
        deliverOn: "2026-08-08",
        actorId: ACTOR,
      }),
    ).rejects.toThrow(CannotDeliver);
  });

  it("creates a draft with no number and links it both ways", async () => {
    const id = await startDelivery({
      sourceId: orderId,
      quantities: { [lineIds[0] as string]: "40", [lineIds[1] as string]: "12" },
      deliverOn: "2026-08-08",
      actorId: ACTOR,
    });
    notes.push(id);

    const [bl] = await db.select().from(document).where(eq(document.id, id)).limit(1);
    expect(bl?.kind).toBe("delivery_note");
    // Same rule as screen 48: one place reserves a number, and it is the issue.
    expect(bl?.number).toBeNull();
    expect(bl?.status).toBe("draft");

    const covered = await sourceOf(id);
    expect(covered[0]?.id).toBe(orderId);
  });

  it("carries no prices, because a delivery note is not a bill", async () => {
    const lines = await db
      .select()
      .from(documentLine)
      .where(eq(documentLine.documentId, notes[1] as string));
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.unitPrice === null)).toBe(true);
    expect(lines.every((line) => line.sourceLineId !== null)).toBe(true);
  });

  it("counts the draft as having delivered NOTHING", async () => {
    // The whole point. A draft is a lorry that has not left.
    const delivered = await coveredAgainst(lineIds);
    expect(delivered).toHaveLength(2);
    expect(delivered.every((line) => line.issued === false)).toBe(true);

    const p = progress({ sources: await sourceLines(orderId), delivered });
    expect(p.linesComplete).toBe(0);
    expect(p.pct).toBe("0");
    expect(p.open).toBe(2);
  });

  it("counts it once it has a number", async () => {
    await db
      .update(document)
      .set({ number: `BL-${stamp}-0118`, status: "issued" })
      .where(eq(document.id, notes[1] as string));

    const delivered = await coveredAgainst(lineIds);
    const p = progress({ sources: await sourceLines(orderId), delivered });

    // 40 of 40 on line one, 12 of 24 on line two.
    expect(p.linesComplete).toBe(1);
    expect(p.open).toBe(1);
    // 52 of 64 units.
    expect(p.pct).toBe("81");
  });

  it("adds a second delivery to the first rather than replacing it", async () => {
    const id = await startDelivery({
      sourceId: orderId,
      quantities: { [lineIds[1] as string]: "12" },
      deliverOn: "2026-08-22",
      actorId: ACTOR,
    });
    notes.push(id);
    await db
      .update(document)
      .set({ number: `BL-${stamp}-0124`, status: "issued" })
      .where(eq(document.id, id));

    const p = progress({
      sources: await sourceLines(orderId),
      delivered: await coveredAgainst(lineIds),
    });
    expect(p.linesComplete).toBe(2);
    expect(p.open).toBe(0);
    expect(p.pct).toBe("100");

    // And the second note's own lines are still its own.
    expect(await deliveryLines(id)).toHaveLength(1);
  });

  it("records the signed copy once, and refuses a second", async () => {
    const id = notes[1] as string;
    await recordSignedCopy({
      documentId: id,
      receivedBy: "M. Saïdi",
      receivedOn: "2026-08-08",
      reserves: "2 colis ouverts à la réception",
      actorId: ACTOR,
    });

    const detail = await detailFor(id);
    expect(detail?.receivedBy).toBe("M. Saïdi");
    // Verbatim. A tidied reserve is evidence of nothing.
    expect(detail?.reserves).toBe("2 colis ouverts à la réception");
    expect(detail?.signedCopyOnFile).not.toBeNull();

    // In a dispute the first signature is the record that matters.
    await expect(
      recordSignedCopy({
        documentId: id,
        receivedBy: "Somebody else",
        receivedOn: "2026-08-20",
        reserves: null,
        actorId: ACTOR,
      }),
    ).rejects.toThrow(CannotDeliver);
  });

  it("lists both notes against the order, with which one is unsigned", async () => {
    const rows = await ours();
    expect(rows).toHaveLength(2);

    const signed = rows.find((row) => row.number === `BL-${stamp}-0118`);
    const unsigned = rows.find((row) => row.number === `BL-${stamp}-0124`);
    expect(signed?.signedCopyOnFile).not.toBeNull();
    expect(signed?.coversNumber).toBe(`DEL/${stamp}/0046`);
    expect(unsigned?.signedCopyOnFile).toBeNull();
    expect(unsigned?.lines).toBe(1);
  });

  it("records in the log that no number was handed out", async () => {
    // The CREATE entry, by name. This used to take "the first row" with no
    // order, which was the create entry only while the planner happened to
    // scan the heap; an index on (entity, entity_id, at) changed that.
    const [entry] = await db
      .select()
      .from(auditEntry)
      .where(and(eq(auditEntry.entityId, notes[1] as string), eq(auditEntry.action, "create")))
      .limit(1);
    const after = entry?.after as Record<string, unknown>;
    expect(after?.numberReserved).toBe(false);
    expect(after?.sourceNumber).toBe(`DEL/${stamp}/0046`);
    expect(entry?.sourceScreen).toBe("49");
  });
});
