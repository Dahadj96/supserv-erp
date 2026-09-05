import { and, eq, inArray, like } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { document } from "@/db/schema/document";
import { importBatch, importRecord } from "@/db/schema/import";
import { party, partyAlias, partyRole, person } from "@/db/schema/party";
import { guessImportable, proposeMapping } from "@/domain/import/columns";
import { prepare, runImport, UndoExpired, undoImport } from "@/domain/import/run";
import { readWorkbook, type Sheet } from "@/domain/import/sheet";
import { searchParties } from "@/domain/search";

/**
 * Screen 62 — Move in.
 *
 * The fixture below is written as a real .xlsx and read back through the real
 * reader, because every bug this code will ever have lives in the gap between
 * "a spreadsheet" and "an object somebody wrote in a test file": merged cells,
 * a title above the header row, a blank separator line, amounts stored as text.
 */
const ACTOR = "test-import-actor";
const batchIds: string[] = [];

async function fixtureWorkbook(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Clients 2026");

  // A title, then a blank line, then the table. This is what real files do.
  ws.addRow(["LISTE CLIENTS — mise à jour 2026"]);
  ws.addRow([]);
  ws.addRow([
    "Client",
    "Nom commercial",
    "NIF",
    "RC",
    "Adresse",
    "Wilaya",
    "Email",
    "Téléphone",
    "Contact",
    "Fonction",
    "Colonne H",
  ]);

  ws.addRow([
    "TEST IMPORT TOUATGAZ",
    "TIT Gaz",
    "000116001234567",
    "16/00-1234567 B 09",
    "Zone industrielle, Adrar",
    "Adrar",
    "contact@test-import-touatgaz.dz",
    "049 96 12 34",
    "Hamza Benkada",
    "Achats",
    "vieux commentaire",
  ]);

  // Missing NIF, and a contact with no name. Imported, not refused.
  ws.addRow([
    "TEST IMPORT BALADNA",
    null,
    null,
    "01/00-7654321 B 12",
    "Route de Reggane",
    "Adrar",
    null,
    null,
    null,
    null,
    null,
  ]);

  // A blank separator line somebody left in.
  ws.addRow([]);

  // No client name at all — skipped.
  ws.addRow([
    null,
    null,
    "000116009999999",
    null,
    "Quelque part",
    null,
    null,
    null,
    null,
    null,
    null,
  ]);

  // A NIF that is present but only ten digits — imported blank, not stored wrong.
  ws.addRow([
    "TEST IMPORT GCB",
    null,
    "0001160012",
    null,
    "Alger",
    "Alger",
    "Contact: J.Ouest@Test-Import-Gcb.dz",
    null,
    null,
    null,
    null,
  ]);

  // The same company twice in one sheet.
  ws.addRow([
    "TEST IMPORT TOUATGAZ",
    null,
    null,
    null,
    "Autre adresse",
    null,
    null,
    null,
    null,
    null,
    null,
  ]);

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** The fixture always has a sheet; this is a type guard, not a check. */
function sheetOrThrow(sheet: Sheet | undefined): Sheet {
  if (!sheet) throw new Error("the fixture workbook produced no sheet");
  return sheet;
}

afterAll(async () => {
  const records = batchIds.length
    ? await db.select().from(importRecord).where(inArray(importRecord.batchId, batchIds))
    : [];

  const personIds = records.filter((r) => r.entity === "person").map((r) => r.entityId);
  const partyIds = records.filter((r) => r.entity === "party").map((r) => r.entityId);

  if (personIds.length) await db.delete(person).where(inArray(person.id, personIds));
  if (partyIds.length) {
    await db.delete(partyAlias).where(inArray(partyAlias.partyId, partyIds));
    await db.delete(partyRole).where(inArray(partyRole.partyId, partyIds));
    await db.delete(document).where(inArray(document.partyId, partyIds));
  }
  if (batchIds.length) await db.delete(importBatch).where(inArray(importBatch.id, batchIds));
  if (partyIds.length) await db.delete(party).where(inArray(party.id, partyIds));
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  await db.delete(party).where(like(party.legalName, "TEST IMPORT %"));
});

describe("screen 62 — bring what you already have", () => {
  it("finds the table under the title and the blank line", async () => {
    const [sheet] = await readWorkbook(await fixtureWorkbook());
    expect(sheet?.name).toBe("Clients 2026");
    expect(sheet?.headers[0]).toBe("Client");
    // Seven data rows were written; the two blank ones are separators, not
    // records, and never reach the count.
    expect(sheet?.rows).toHaveLength(5);
  });

  it("proposes a mapping and says what it is ignoring", async () => {
    const [sheet] = await readWorkbook(await fixtureWorkbook());
    const becomes = guessImportable(sheet?.headers ?? []);
    expect(becomes).toBe("party");

    const mapping = proposeMapping(sheet?.headers ?? [], becomes);
    expect(mapping["Colonne H"], "named as ignored, not silently dropped").toBeNull();
  });

  it("counts every problem without refusing the file", async () => {
    const [sheet] = await readWorkbook(await fixtureWorkbook());
    const mapping = proposeMapping(sheet?.headers ?? [], "party");
    const prepared = await prepare(sheetOrThrow(sheet), mapping, "party");

    expect(prepared.skipped, "the row with no client name").toHaveLength(1);
    expect(prepared.problems.noName).toBe(1);
    // Two rows have no NIF at all, and one has a NIF that is not fifteen digits.
    expect(prepared.problems.missingNif).toBe(2);
    expect(prepared.problems.badNif).toBe(1);
    expect(prepared.problems.duplicates).toBe(1);

    // The file still produced four importable companies.
    expect(prepared.parties).toHaveLength(4);
  });

  it("imports, allocates references, and makes the trade name findable", async () => {
    const [sheet] = await readWorkbook(await fixtureWorkbook());
    const mapping = proposeMapping(sheet?.headers ?? [], "party");
    const prepared = await prepare(sheetOrThrow(sheet), mapping, "party");

    const { batchId, imported } = await runImport({
      prepared,
      filename: "Clients.xlsx",
      sheetName: "Clients 2026",
      mapping,
      actorId: ACTOR,
      role: "client",
    });
    batchIds.push(batchId);

    // Four companies plus the one contact that had a name.
    expect(imported).toBe(5);

    const rows = await db.select().from(party).where(like(party.legalName, "TEST IMPORT %"));
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => /^CL-\d{4}$/.test(r.code))).toBe(true);

    const touatgaz = rows.find((r) => r.legalName === "TEST IMPORT TOUATGAZ");
    expect(touatgaz?.nif, "fifteen digits, kept").toBe("000116001234567");

    const gcb = rows.find((r) => r.legalName === "TEST IMPORT GCB");
    expect(gcb?.nif, "ten digits — imported blank, never stored wrong").toBeNull();
    expect(gcb?.email, "found inside 'Contact: J.Ouest@…'").toBe("j.ouest@test-import-gcb.dz");

    // Screen 82 must work on an imported company exactly as on a typed one.
    const hits = await searchParties("TIT Gaz", 20);
    expect(hits.map((h) => h.id)).toContain(touatgaz?.id);
  });

  it("brings the contact along, attached to their company", async () => {
    const [row] = await db.select().from(person).where(eq(person.fullName, "Hamza Benkada"));
    expect(row?.source).toBe("import");
    expect(row?.relationship).toBe("external");
    expect(row?.trade).toBe("Achats");
  });

  it("undoes to the bin, not to nothing", async () => {
    const batchId = batchIds[0] as string;
    const { removed } = await undoImport(batchId, ACTOR);
    expect(removed).toBe(5);

    const rows = await db.select().from(party).where(like(party.legalName, "TEST IMPORT %"));
    // Still there — screen 83: discard is the 30-day bin, not a delete.
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.deletedAt !== null)).toBe(true);
    expect(rows[0]?.deleteReason).toContain("Clients.xlsx");

    // And gone from search, which is what "undone" has to mean in practice.
    // Not "search returns nothing" — a real GROUPEMENT TOUATGAZ in this
    // database answers that query on trigram similarity, and rightly so.
    const hits = await searchParties("TEST IMPORT TOUATGAZ", 20);
    expect(hits.map((h) => h.legalName)).not.toContain("TEST IMPORT TOUATGAZ");
  });

  it("keeps a company that has been used since, and says so", async () => {
    const [sheet] = await readWorkbook(await fixtureWorkbook());
    const mapping = proposeMapping(sheet?.headers ?? [], "party");
    const prepared = await prepare(sheetOrThrow(sheet), mapping, "party");
    const { batchId } = await runImport({
      prepared,
      filename: "Clients-2.xlsx",
      sheetName: "Clients 2026",
      mapping,
      actorId: ACTOR,
      role: "client",
    });
    batchIds.push(batchId);

    // The one THIS batch created. The first import left a discarded BALADNA
    // behind, and picking that one would test nothing.
    const [used] = await db
      .select({ id: party.id })
      .from(party)
      .innerJoin(importRecord, eq(importRecord.entityId, party.id))
      .where(and(eq(importRecord.batchId, batchId), eq(party.legalName, "TEST IMPORT BALADNA")));

    // Somebody issued an invoice against it in the meantime. It is no longer a
    // draft nobody saw, and taking it away would break what they built on it.
    await db.insert(document).values({
      kind: "invoice",
      number: "SUP/2026/9001",
      partyId: used?.id as string,
      locale: "fr",
      status: "issued",
      totals: {},
    });

    const { removed, kept } = await undoImport(batchId, ACTOR);
    expect(kept).toBe(1);
    expect(removed).toBeGreaterThan(0);

    const [survivor] = await db
      .select()
      .from(party)
      .where(eq(party.id, used?.id as string));
    expect(survivor?.deletedAt).toBeNull();
  });

  it("refuses an undo after the seven days are up", async () => {
    const batchId = batchIds[0] as string;
    await db
      .update(importBatch)
      .set({ undoneAt: null, undoableUntil: new Date(Date.now() - 86_400_000) })
      .where(eq(importBatch.id, batchId));

    await expect(undoImport(batchId, ACTOR)).rejects.toBeInstanceOf(UndoExpired);
  });

  it("writes down what the import did, and what it could not read", async () => {
    // THE FIRST batch's entry, named. `where(actorId)` alone returns whichever
    // row Postgres hands back first, and by now this actor has written four —
    // so it passed alone and failed in the suite, which is the worst kind of
    // test there is.
    const [logged] = await db
      .select()
      .from(auditEntry)
      .where(and(eq(auditEntry.actorId, ACTOR), eq(auditEntry.entityId, batchIds[0] as string)));
    expect(logged?.entity).toBe("import_batch");
    expect(logged?.sourceScreen).toBe("62");
    const after = logged?.after as { problems?: Record<string, number> };
    expect(after?.problems?.noName).toBe(1);
  });

  it("is not derailed by a company whose code we did not allocate", async () => {
    // A code carried over from the old system, or typed by hand. This used to
    // make EVERY subsequent import fail — `nextCode` cast the tail of every
    // `CL-` code to an integer — and the error named the company, so it read as
    // a problem with the spreadsheet.
    const [odd] = await db
      .insert(party)
      .values({ code: "CL-ANCIEN-07", legalName: "TEST IMPORT LEGACY CODE" })
      .returning({ id: party.id });

    try {
      const [sheet] = await readWorkbook(await fixtureWorkbook());
      const mapping = proposeMapping(sheet?.headers ?? [], "party");
      const prepared = await prepare(sheetOrThrow(sheet), mapping, "party");
      // The assertion is that this RETURNS. Before the fix it threw
      // `invalid input syntax for type integer: "ANCIEN-07"`. How many rows it
      // imports is not the point — by now the fixture's companies already
      // exist, so most of them are correctly skipped as duplicates.
      const { batchId } = await runImport({
        prepared,
        filename: "Clients.xlsx",
        sheetName: "Clients 2026",
        mapping,
        actorId: ACTOR,
        role: "client",
      });
      batchIds.push(batchId);
      expect(batchId).toBeTruthy();
    } finally {
      await db.delete(party).where(eq(party.id, odd?.id as string));
    }
  });
});
