import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { document, documentLine, documentLink } from "@/db/schema/document";
import { party, partyRole } from "@/db/schema/party";
import { CannotConvert, chainFor, convertDocument } from "@/documents/convert";

/**
 * Screen 48, against a real database.
 *
 * "The proforma is never replaced. It stays on file, linked to the facture, and
 * its number is not reused."
 *
 * The assertions that matter are the ones about what did NOT happen: the
 * proforma is untouched, no number was handed out, and a second conversion is
 * refused.
 */
const ACTOR = "test-convert-actor";
const stamp = Date.now().toString().slice(-5);

let clientId = "";
let proformaId = "";
let draftId = "";
const created: string[] = [];

beforeAll(async () => {
  const [client] = await db
    .insert(party)
    .values({ code: `CL-7${stamp}`, legalName: "TEST CONV BALADNA", tradeName: "BALADNA ALGERIA" })
    .returning({ id: party.id });
  clientId = client?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });

  const [proforma] = await db
    .insert(document)
    .values({
      kind: "proforma",
      number: `CONV/${stamp}/0089`,
      partyId: clientId,
      locale: "fr",
      status: "issued",
      issuedOn: "2026-08-12",
      currency: "DZD",
      totals: { totalExcl: "1000000", totalIncl: "1190000" },
    })
    .returning({ id: document.id });
  proformaId = proforma?.id as string;

  const [draft] = await db
    .insert(document)
    .values({
      kind: "proforma",
      number: null,
      partyId: clientId,
      locale: "fr",
      status: "draft",
      totals: { totalExcl: "0" },
    })
    .returning({ id: document.id });
  draftId = draft?.id as string;

  await db.insert(documentLine).values([
    {
      documentId: proformaId,
      position: 1,
      lineKind: "section",
      designation: "Lot 1 — climatisation",
    },
    {
      documentId: proformaId,
      position: 2,
      lineKind: "item",
      designation: "Climatiseur 24000 BTU",
      qty: "10",
      unitPrice: "80000",
      vatRate: "19.00",
      unitCost: "62000",
      costSource: "supplier_quote",
      totalExcl: "800000",
    },
    {
      documentId: proformaId,
      position: 3,
      lineKind: "item",
      designation: "Support mural",
      qty: "10",
      unitPrice: "20000",
      vatRate: "19.00",
      totalExcl: "200000",
    },
    // Priced, printed, and counted towards nothing.
    {
      documentId: proformaId,
      position: 4,
      lineKind: "item",
      isOption: true,
      designation: "Contrat d'entretien 12 mois",
      qty: "1",
      unitPrice: "150000",
      vatRate: "19.00",
      totalExcl: "150000",
    },
  ]);
});

afterAll(async () => {
  const all = [proformaId, draftId, ...created].filter(Boolean);
  await db.delete(documentLink).where(inArray(documentLink.fromDocument, all));
  await db.delete(documentLine).where(inArray(documentLine.documentId, all));
  await db.delete(document).where(inArray(document.id, all));
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  await db.delete(partyRole).where(eq(partyRole.partyId, clientId));
  await db.delete(party).where(eq(party.id, clientId));
});

describe("converting a proforma", () => {
  it("refuses a document the client has never seen", async () => {
    // Converting a draft is not converting anything — there is nothing to
    // preserve, and the honest action is to edit it.
    await expect(
      convertDocument({
        documentId: draftId,
        target: "invoice",
        invoiceDate: "2026-08-18",
        dueDate: "2026-09-17",
        paymentMethod: null,
        actorId: ACTOR,
      }),
    ).rejects.toThrow(CannotConvert);
  });

  it("refuses a conversion that is not one of the allowed ones", async () => {
    await expect(
      convertDocument({
        documentId: proformaId,
        target: "quotation",
        invoiceDate: "2026-08-18",
        dueDate: null,
        paymentMethod: null,
        actorId: ACTOR,
      }),
    ).rejects.toThrow(CannotConvert);
  });

  it("creates a draft facture with no number", async () => {
    const id = await convertDocument({
      documentId: proformaId,
      target: "invoice",
      invoiceDate: "2026-08-18",
      dueDate: "2026-09-17",
      paymentMethod: "Virement 30 j",
      actorId: ACTOR,
    });
    created.push(id);

    const [made] = await db.select().from(document).where(eq(document.id, id)).limit(1);
    expect(made?.kind).toBe("invoice");
    // The number is reserved by the transaction that ISSUES it. Handing one out
    // here would show two people converting on the same afternoon the same next
    // number, and an abandoned draft would leave a hole in the register.
    expect(made?.number).toBeNull();
    expect(made?.status).toBe("draft");
    expect(made?.issuedOn).toBe("2026-08-18");
    expect(made?.dueOn).toBe("2026-09-17");
  });

  it("leaves the proforma exactly as it was", async () => {
    const [after] = await db.select().from(document).where(eq(document.id, proformaId)).limit(1);
    expect(after?.number).toBe(`CONV/${stamp}/0089`);
    expect(after?.kind).toBe("proforma");
    expect(after?.status).toBe("issued");
    expect(after?.issuedOn).toBe("2026-08-12");

    const lines = await db
      .select()
      .from(documentLine)
      .where(eq(documentLine.documentId, proformaId));
    // Including the option. It was dropped from the copy, not from the original.
    expect(lines).toHaveLength(4);
  });

  it("drops the optional line and renumbers what is left", async () => {
    const lines = await db
      .select()
      .from(documentLine)
      .where(eq(documentLine.documentId, created[0] as string))
      .orderBy(asc(documentLine.position));

    expect(lines).toHaveLength(3);
    expect(lines.some((l) => l.isOption)).toBe(false);
    // No gap where position 4 used to be.
    expect(lines.map((l) => l.position)).toEqual([1, 2, 3]);
    expect(lines.map((l) => l.designation)).toEqual([
      "Lot 1 — climatisation",
      "Climatiseur 24000 BTU",
      "Support mural",
    ]);
  });

  it("recomputes the totals without the option", async () => {
    const [made] = await db
      .select({ totals: document.totals })
      .from(document)
      .where(eq(document.id, created[0] as string))
      .limit(1);
    const totals = made?.totals as { totalExcl: string; totalIncl: string; optionsExcl: string };
    // 800 000 + 200 000, and the 150 000 option counts for nothing.
    expect(totals.totalExcl).toBe("1000000.00");
    expect(totals.totalIncl).toBe("1190000.00");
  });

  it("carries the cost trail across so the margin keeps working", async () => {
    const lines = await db
      .select()
      .from(documentLine)
      .where(eq(documentLine.documentId, created[0] as string))
      .orderBy(asc(documentLine.position));
    const priced = lines.find((l) => l.designation === "Climatiseur 24000 BTU");
    expect(priced?.unitCost).toBe("62000.0000");
    expect(priced?.costSource).toBe("supplier_quote");
  });

  it("links the two rather than replacing one with the other", async () => {
    const chain = await chainFor(created[0] as string);
    expect(chain.from?.id).toBe(proformaId);
    expect(chain.from?.number).toBe(`CONV/${stamp}/0089`);

    const back = await chainFor(proformaId);
    expect(back.to?.id).toBe(created[0]);
    expect(back.to?.number).toBeNull();
  });

  it("records in the log that no number was handed out", async () => {
    const [entry] = await db
      .select()
      .from(auditEntry)
      .where(eq(auditEntry.entityId, created[0] as string))
      .limit(1);
    const after = entry?.after as Record<string, unknown>;
    expect(after?.numberReserved).toBe(false);
    expect(after?.sourceNumber).toBe(`CONV/${stamp}/0089`);
    expect(after?.optionsDropped).toBe(1);
    expect(entry?.sourceScreen).toBe("48");
  });

  it("refuses to convert the same proforma twice", async () => {
    // Somebody clicking twice, or somebody about to invoice a client for the
    // same thing a second time.
    await expect(
      convertDocument({
        documentId: proformaId,
        target: "invoice",
        invoiceDate: "2026-08-19",
        dueDate: null,
        paymentMethod: null,
        actorId: ACTOR,
      }),
    ).rejects.toThrow(CannotConvert);
  });
});
