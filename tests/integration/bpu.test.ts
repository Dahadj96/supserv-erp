import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine, priceQuote } from "@/db/schema/deal";
import { document, documentLine } from "@/db/schema/document";
import { importBatch } from "@/db/schema/import";
import { item } from "@/db/schema/item";
import { party, partyRole } from "@/db/schema/party";
import { tender } from "@/db/schema/tender";
import { createDeal } from "@/domain/deal/deal";
import type { BpuLine } from "@/domain/tender/bpu";
import {
  applyErratum,
  applyLastPrices,
  applyPendingErratum,
  BpuRefused,
  bpu,
  discardErratum,
  importBpu,
  pendingErratum,
  recordErratum,
  rememberedMapping,
  reviewErratum,
  saveMapping,
} from "@/domain/tender/bpu-store";
import { makeTender } from "@/domain/tender/store";

/**
 * Screen 42 against a real database.
 *
 * The case the screen exists for: forty-two lines imported, thirty-one priced,
 * and a fortnight before the deadline the buyer issues an erratum. Line 12's
 * quantity moves, line 18 is reworded, line 27 changes unit, line 33 is
 * removed. Re-importing would be correct and would throw away every price.
 */
const ACTOR = "test-bpu-actor";
const stamp = Date.now().toString().slice(-6);

let clientId = "";
let dealId = "";
let secondDealId = "";

/** Positions 1..4, which the erratum below moves in four different ways. */
const IMPORTED: BpuLine[] = [
  {
    position: 1,
    reference: "P-01",
    designation: "Fourniture et pose de canalisation",
    unit: "ml",
    qty: "1200",
  },
  { position: 2, reference: "P-02", designation: "Vanne papillon DN80", unit: "U", qty: "12" },
  {
    position: 3,
    reference: "P-03",
    designation: "Terrassement en tranchée",
    unit: "ml",
    qty: "1500",
  },
  { position: 4, reference: "P-04", designation: "Support béton", unit: "ml", qty: "24" },
];

const ERRATUM: BpuLine[] = [
  // 1 — the quantity moves. The unit price of a metre of pipe does not.
  {
    position: 1,
    reference: "P-01",
    designation: "Fourniture et pose de canalisation",
    unit: "ml",
    qty: "1400",
  },
  // 2 — reworded into a different article. DN80 is not DN100.
  { position: 2, reference: "P-02", designation: "Vanne papillon DN100", unit: "U", qty: "12" },
  // 3 — the unit changes. A price per metre is not a price per unit.
  {
    position: 3,
    reference: "P-03",
    designation: "Terrassement en tranchée",
    unit: "U",
    qty: "1500",
  },
  // 4 is gone, and 5 has arrived.
  { position: 5, reference: "P-05", designation: "Mise à la terre", unit: "U", qty: "8" },
];

async function lineIdAt(position: number): Promise<string> {
  const [row] = await db
    .select({ id: dealLine.id })
    .from(dealLine)
    .where(and(eq(dealLine.dealId, dealId), eq(dealLine.position, position)));
  return row?.id as string;
}

beforeAll(async () => {
  const [client] = await db
    .insert(party)
    .values({ code: `CL-B${stamp}`, legalName: "TEST BPU — SADEG ADRAR" })
    .returning({ id: party.id });
  clientId = client?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });

  const make = async (subject: string) =>
    createDeal(
      {
        partyId: clientId,
        subject,
        contactPersonId: null,
        clientReference: `AONR ${stamp}`,
        receivedAt: new Date("2026-08-01T08:00:00Z"),
        deadlineAt: new Date("2026-09-02T10:00:00Z"),
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

  dealId = await make("Travaux de raccordement — bordereau");
  secondDealId = await make("Second bordereau");

  for (const id of [dealId, secondDealId]) {
    await makeTender({
      dealId: id,
      procedure: "aonr",
      submissionPlace: "DD Adrar",
      cautionPct: "1",
      actorId: ACTOR,
    });
  }
});

describe("importing the bordereau", () => {
  it("makes the client's lines the BPU, with their own numbering", async () => {
    await importBpu({ dealId, lines: IMPORTED, filename: "BPU.xls", actorId: ACTOR });

    const view = await bpu(dealId);
    expect(view?.rows.map((row) => row.position)).toEqual([1, 2, 3, 4]);
    expect(view?.source).toBe("BPU.xls");
    expect(view?.rows.every((row) => row.state === "noPrice")).toBe(true);
    expect(view?.totals.noPrice).toBe(4);
  });

  it("refuses a second file against lines that already exist", async () => {
    // This refusal is the safety of the screen. A second upload is an erratum.
    await expect(
      importBpu({ dealId, lines: IMPORTED, filename: "BPU (2).xls", actorId: ACTOR }),
    ).rejects.toThrow(BpuRefused);
  });

  it("remembers the client's column mapping so nobody confirms it twice", async () => {
    await saveMapping({
      partyId: clientId,
      mapping: { "N° de prix": "lineNumber", Désignation: "designation", Quantité: "quantity" },
      actorId: ACTOR,
    });
    expect(await rememberedMapping(clientId)).toMatchObject({ "N° de prix": "lineNumber" });
  });

  it("refuses a mapping without the three columns that make it a bordereau", async () => {
    await expect(
      saveMapping({ partyId: clientId, mapping: { Désignation: "designation" }, actorId: ACTOR }),
    ).rejects.toThrow(BpuRefused);
  });
});

describe("costing from what we last paid", () => {
  it("writes an internal costing only where no cost is held", async () => {
    // A supplier price on line 1, gathered this time round.
    await db.insert(priceQuote).values({
      dealLineId: await lineIdAt(1),
      dealId,
      source: "supplier_proforma",
      price: "1910",
      currency: "DZD",
      capturedBy: ACTOR,
    });

    // Line 2 is an article we have bought before, on an ISSUED bon de commande.
    const [valve] = await db
      .insert(item)
      .values({
        // Not `ITM-…`: `nextItemCode` parses the suffix of every code with
        // that prefix as an integer, and a test code with a letter in it makes
        // the catalogue unable to allocate the next one.
        code: `TST-B${stamp}`,
        designation: "Vanne papillon DN80 PN16",
        unit: "U",
        kind: "good",
      })
      .returning({ id: item.id });

    await db
      .update(dealLine)
      .set({ itemId: valve?.id as string })
      .where(eq(dealLine.id, await lineIdAt(2)));

    const [issued] = await db
      .insert(document)
      .values({
        kind: "purchase_order",
        number: `BC-TEST-${stamp}`,
        partyId: clientId,
        issuedOn: "2025-11-04",
        currency: "DZD",
        locale: "fr",
        totals: {},
      })
      .returning({ id: document.id });

    await db.insert(documentLine).values({
      documentId: issued?.id as string,
      position: 1,
      lineKind: "item",
      itemId: valve?.id as string,
      designation: "Vanne papillon DN80 PN16",
      qty: "10",
      unitCost: "21400",
    });

    // The last price PAID, from a document, not from what a supplier said.
    const before = await bpu(dealId);
    expect(before?.rows.find((row) => row.position === 2)?.lastPaid).toBe("21400.0000");
    expect(before?.knownBefore).toBe(1);

    const { applied } = await applyLastPrices({ dealId, actorId: ACTOR });
    expect(applied).toBe(1);

    const after = await bpu(dealId);
    // Line 1 already had a supplier's price. It is not overwritten with a
    // figure from November.
    expect(after?.rows.find((row) => row.position === 1)?.cost).toBe("1910.0000");
    expect(after?.rows.find((row) => row.position === 2)?.cost).toBe("21400.0000");

    // And it is written as our own costing, not as something a supplier said.
    const [costing] = await db
      .select()
      .from(priceQuote)
      .where(
        and(
          eq(priceQuote.dealLineId, await lineIdAt(2)),
          eq(priceQuote.source, "internal_costing"),
        ),
      );
    expect(costing?.partyId).toBeNull();

    // Twice changes nothing: there is a cost on every line that had a history.
    expect((await applyLastPrices({ dealId, actorId: ACTOR })).applied).toBe(0);
  });
});

describe("the erratum", () => {
  it("reports the quantity change before the rewording, because quantity moves the money", async () => {
    const review = await reviewErratum(dealId, ERRATUM);
    const kinds = Object.fromEntries(
      (review?.material ?? []).map((change) => [change.position, change.kind]),
    );

    expect(kinds).toEqual({
      1: "quantityChanged",
      2: "designationChanged",
      3: "unitChanged",
      4: "removed",
      5: "added",
    });
    expect(review?.summary.losesPrice).toBe(2);
  });

  it("keeps the price on a line whose quantity moved and expires it on one reworded", async () => {
    const line2 = await lineIdAt(2);
    await db.insert(priceQuote).values({
      dealLineId: line2,
      dealId,
      source: "supplier_proforma",
      price: "22100",
      currency: "DZD",
      capturedBy: ACTOR,
    });

    const line1 = await lineIdAt(1);
    const result = await applyErratum({
      dealId,
      incoming: ERRATUM,
      actorId: ACTOR,
      reason: "Erratum du 14 août",
      now: new Date("2026-08-14T09:00:00Z"),
    });

    // Two on line 2: the supplier's proforma and the internal costing taken
    // from what we last paid. Both were for the DN80 and neither is for a DN100.
    expect(result).toMatchObject({ added: 1, removed: 1, updated: 3, quotesExpired: 2 });

    // Line 1 moved from 1 200 to 1 400 and kept the 1 910 a supplier gave —
    // the unit price of a metre of pipe does not depend on how many they want.
    const [kept] = await db.select().from(priceQuote).where(eq(priceQuote.dealLineId, line1));
    expect(kept?.validUntil).toBeNull();

    // Line 2 was reworded into a different valve. The quote is NOT deleted:
    // what a supplier said DN80 cost in August is evidence. It is stamped
    // stale, which is the mechanism the schema already carries for exactly this.
    const [stale] = await db
      .select()
      .from(priceQuote)
      .where(and(eq(priceQuote.dealLineId, line2), eq(priceQuote.source, "supplier_proforma")));
    expect(stale?.price).toBe("22100.0000");
    expect(stale?.validUntil).toBe("2026-08-14");
  });

  it("stops counting a stale price as a cost", async () => {
    const view = await bpu(dealId);
    expect(view?.rows.find((row) => row.position === 2)?.cost).toBeNull();
    expect(view?.rows.find((row) => row.position === 1)?.cost).toBe("1910.0000");
  });

  it("leaves the lines as the buyer numbered them", async () => {
    const view = await bpu(dealId);
    expect(view?.rows.map((row) => row.position)).toEqual([1, 2, 3, 5]);
    expect(view?.rows.find((row) => row.position === 1)?.qty).toBe("1400.000");
    expect(view?.rows.find((row) => row.position === 2)?.designation).toBe("Vanne papillon DN100");
    expect(view?.rows.find((row) => row.position === 3)?.unit).toBe("U");
  });

  it("writes one audit entry naming every line it moved", async () => {
    const [entry] = await db
      .select()
      .from(auditEntry)
      .where(and(eq(auditEntry.entityId, dealId), eq(auditEntry.action, "erratum")));

    const after = entry?.after as { changed: { position: number; kind: string }[] };
    expect(after.changed.map((change) => change.position).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(entry?.sourceScreen).toBe("42");
    expect(entry?.reason).toBe("Erratum du 14 août");
  });

  it("refuses an erratum that changes nothing", async () => {
    await expect(applyErratum({ dealId, incoming: ERRATUM, actorId: ACTOR })).rejects.toThrow(
      BpuRefused,
    );
  });
});

describe("an erratum against an offer already issued", () => {
  it("refuses until somebody says in writing that they know", async () => {
    await importBpu({ dealId: secondDealId, lines: IMPORTED, actorId: ACTOR });

    const [issued] = await db
      .insert(document)
      .values({
        kind: "quotation",
        number: `DEV-TEST-${stamp}`,
        partyId: clientId,
        dealId: secondDealId,
        issuedOn: "2026-08-10",
        currency: "DZD",
        locale: "fr",
        totals: {},
      })
      .returning({ id: document.id });

    const [firstLine] = await db
      .select({ id: dealLine.id })
      .from(dealLine)
      .where(and(eq(dealLine.dealId, secondDealId), eq(dealLine.position, 2)));

    await db.insert(documentLine).values({
      documentId: issued?.id as string,
      position: 1,
      lineKind: "item",
      dealLineId: firstLine?.id as string,
      designation: "Vanne papillon DN80",
      qty: "12",
      unitPrice: "25636",
    });

    const review = await reviewErratum(secondDealId, ERRATUM);
    expect(review?.issuedOffers).toEqual([`DEV-TEST-${stamp}`]);

    await expect(
      applyErratum({ dealId: secondDealId, incoming: ERRATUM, actorId: ACTOR }),
    ).rejects.toThrow(BpuRefused);

    await applyErratum({
      dealId: secondDealId,
      incoming: ERRATUM,
      actorId: ACTOR,
      acknowledgeIssued: true,
      reason: "Erratum reçu après dépôt de l'offre",
    });

    // LAW 5. The issued document still carries the price it was issued with.
    const [line] = await db
      .select()
      .from(documentLine)
      .where(eq(documentLine.documentId, issued?.id as string));
    expect(line?.unitPrice).toBe("25636.0000");
  });
});

describe("an erratum as it arrives", () => {
  it("waits as a pending row and is applied once", async () => {
    const third = await createDeal(
      {
        partyId: clientId,
        subject: "Troisième bordereau",
        contactPersonId: null,
        clientReference: `AONR ${stamp}-3`,
        receivedAt: new Date("2026-08-01T08:00:00Z"),
        deadlineAt: new Date("2026-09-02T10:00:00Z"),
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
    await makeTender({ dealId: third, procedure: "aonr", cautionPct: "1", actorId: ACTOR });
    await importBpu({ dealId: third, lines: IMPORTED, filename: "BPU.xls", actorId: ACTOR });

    const { id } = await recordErratum({
      dealId: third,
      lines: ERRATUM,
      filename: "ERRATUM.xls",
      receivedOn: "2026-08-14",
      actorId: ACTOR,
    });

    // Nothing has moved yet, and the screen can say how many lines will.
    const before = await bpu(third);
    expect(before?.rows).toHaveLength(4);
    expect(before?.changedByErratum).toBe(5);

    await expect(recordErratum({ dealId: third, lines: ERRATUM, actorId: ACTOR })).rejects.toThrow(
      BpuRefused,
    );

    const waiting = await pendingErratum(third);
    expect(waiting?.filename).toBe("ERRATUM.xls");
    expect(waiting?.receivedOn).toBe("2026-08-14");

    await applyPendingErratum({ erratumId: id, actorId: ACTOR });

    const after = await bpu(third);
    expect(after?.rows.map((row) => row.position)).toEqual([1, 2, 3, 5]);
    expect(after?.changedByErratum).toBe(0);
    expect(await pendingErratum(third)).toBeNull();

    await expect(applyPendingErratum({ erratumId: id, actorId: ACTOR })).rejects.toThrow(
      BpuRefused,
    );
  });

  it("keeps a discarded erratum as evidence that it arrived", async () => {
    const [row] = await db.select({ id: deal.id }).from(deal).where(eq(deal.id, dealId));
    expect(row?.id).toBe(dealId);

    const { id } = await recordErratum({
      dealId,
      lines: [
        ...ERRATUM,
        { position: 9, reference: null, designation: "Ajout", unit: "U", qty: "1" },
      ],
      filename: "ERRATUM-2.xls",
      actorId: ACTOR,
    });

    await expect(discardErratum({ erratumId: id, actorId: ACTOR, reason: "" })).rejects.toThrow(
      BpuRefused,
    );

    await discardErratum({ erratumId: id, actorId: ACTOR, reason: "Retiré par l'acheteur" });
    expect(await pendingErratum(dealId)).toBeNull();

    const [entry] = await db
      .select()
      .from(auditEntry)
      .where(and(eq(auditEntry.entityId, id), eq(auditEntry.action, "discard")));
    expect(entry?.reason).toBe("Retiré par l'acheteur");
  });
});

/**
 * Task 2.8 — where a bordereau's provenance goes on a deal that is not a tender.
 *
 * `importBpu` used to update the `tender` row unconditionally. On a plain
 * enquiry there is no such row, so the update matched nothing, returned
 * cleanly, and the filename went nowhere: screen 42's header went on saying the
 * lines had been typed, about figures that came out of a spreadsheet.
 *
 * Both branches are here because the done-when asked for both, and because the
 * one that used to be silent is the one worth a test.
 */
describe("where the bordereau says it came from", () => {
  /** A deal nobody has made a tender. Screen 42 works on one; `bpu()` leftJoins. */
  const plainDeal = async (subject: string) =>
    createDeal(
      {
        partyId: clientId,
        subject,
        contactPersonId: null,
        clientReference: `RFQ ${stamp}`,
        receivedAt: new Date("2026-08-01T08:00:00Z"),
        deadlineAt: new Date("2026-09-02T10:00:00Z"),
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

  it("caches it on the tender row when there is one", async () => {
    const view = await bpu(dealId);
    expect(view?.source).toBe("BPU.xls");

    const [row] = await db
      .select({ source: tender.bpuSource, at: tender.bpuImportedAt })
      .from(tender)
      .where(eq(tender.dealId, dealId));
    expect(row?.source).toBe("BPU.xls");
    expect(row?.at).not.toBeNull();
  });

  it("says so, rather than silently, when there is no tender row to cache it on", async () => {
    const plain = await plainDeal("Bordereau on a plain enquiry");

    const result = await importBpu({
      dealId: plain,
      lines: IMPORTED,
      filename: "DEVIS-CLIENT.xlsx",
      actorId: ACTOR,
    });

    // The old behaviour returned `{ imported: 4 }` here and told nobody that
    // the filename had gone nowhere. This is the half of the done-when that
    // says it cannot: the caller is told which of the two happened.
    expect(result).toEqual({ imported: 4, provenanceOn: "batch" });

    // And the audit entry carries the filename whatever happens to any row —
    // including a tender conversion being undone, which deletes it.
    const [entry] = await db
      .select()
      .from(auditEntry)
      .where(and(eq(auditEntry.entityId, plain), eq(auditEntry.action, "importBpu")));
    expect(entry?.after).toMatchObject({
      filename: "DEVIS-CLIENT.xlsx",
      lines: 4,
      provenanceOn: "batch",
    });
  });

  it("prints it on the header of a plain deal, read from the import batch", async () => {
    /*
      THE BUG ITSELF. `commitBpuBatch` writes one `import_batch` row per sheet
      with the filename, the deal and the moment it was imported — screen 42's
      Sources tab has been listing them all along — so the provenance was never
      actually lost, only unreachable by the header. The row is written here the
      way that function writes it: `becomes: "deal_line"`, `status: "imported"`,
      and an `importedAt`, which are the three fields `importedFrom` filters and
      orders on.
    */
    const plain = await plainDeal("Bordereau with a batch behind it");
    const at = new Date("2026-08-03T09:30:00Z");

    await db.insert(importBatch).values({
      filename: "BORDEREAU-SADEG.xlsx",
      becomes: "deal_line",
      dealId: plain,
      mapping: {},
      status: "imported",
      rowsTotal: 4,
      rowsImported: 4,
      createdBy: ACTOR,
      importedAt: at,
    });
    await importBpu({
      dealId: plain,
      lines: IMPORTED,
      filename: "BORDEREAU-SADEG.xlsx",
      actorId: ACTOR,
    });

    const view = await bpu(plain);
    expect(view?.source).toBe("BORDEREAU-SADEG.xlsx");
    expect(view?.importedAt?.toISOString()).toBe(at.toISOString());
  });

  it("ignores an erratum sheet and a batch nobody finished", async () => {
    /*
      An erratum is a different sheet answering a different question — it does
      not become the lines — and a batch abandoned at the mapping step is a file
      somebody opened and thought better of. Either one claiming to be where the
      bordereau came from would be worse than the header saying nothing.
    */
    const plain = await plainDeal("Bordereau with only the wrong batches");

    await db.insert(importBatch).values([
      {
        filename: "ERRATUM-1.xlsx",
        becomes: "bpu_erratum",
        dealId: plain,
        mapping: {},
        status: "imported",
        createdBy: ACTOR,
        importedAt: new Date("2026-08-10T09:00:00Z"),
      },
      {
        filename: "ABANDONNE.xlsx",
        becomes: "deal_line",
        dealId: plain,
        mapping: {},
        status: "mapping",
        createdBy: ACTOR,
      },
    ]);
    await importBpu({ dealId: plain, lines: IMPORTED, actorId: ACTOR });

    const view = await bpu(plain);
    expect(view?.source).toBeNull();
    expect(view?.importedAt).toBeNull();
  });
});
