import { and, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { dealLine } from "@/db/schema/deal";
import { party, partyRole } from "@/db/schema/party";
import { tender } from "@/db/schema/tender";
import { createDeal } from "@/domain/deal/deal";
import {
  BpuUnreadable,
  bpuSources,
  commitBpuBatch,
  loadBpuBatch,
  previewBpu,
} from "@/domain/tender/bpu-batch";
import { bpu, pendingErratum, rememberedMapping } from "@/domain/tender/bpu-store";
import { makeTender } from "@/domain/tender/store";

/**
 * Screen 42, from an actual spreadsheet.
 *
 * ACCEPTANCE.md said, until this file existed: "no test uploads a real
 * spreadsheet — the reader is the one piece of this system whose behaviour on a
 * real client's .xls has been reasoned about and not demonstrated." This
 * demonstrates it, on a workbook shaped like the ones that arrive: a title row
 * above the table, a section heading in the middle of it, a TOTAL at the
 * bottom, quantities written four different ways, and a column nobody asked
 * for.
 *
 * The bytes go through storage and are read TWICE — once to propose the
 * mapping, once to apply the confirmed one — which is the arrangement that
 * stops the preview and the import disagreeing about what was in the file.
 */
const ACTOR = "test-bpuimport-actor";
const stamp = Date.now().toString().slice(-6);

let clientId = "";
let dealId = "";

/** A bordereau as SADEG publishes one. */
async function bordereau(rows: (string | number | null)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("BPU");

  // Real files start with a title and a blank line, not with the header row.
  sheet.addRow(["BORDEREAU DES PRIX UNITAIRES"]);
  sheet.addRow([]);
  sheet.addRow(["N° de prix", "Désignation", "Unité", "Quantité", "Prix unitaire", "Observations"]);
  for (const row of rows) sheet.addRow(row);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

const FIRST: (string | number | null)[][] = [
  ["LOT 1 — CANALISATIONS", null, null, null, null, null],
  ["1", "Fourniture et pose de canalisation DN200", "ml", "1 200", null, null],
  // A comma decimal, which is how a quantity is written here.
  ["2", "Terrassement en tranchée", "m3", "1.500,5", null, null],
  ["LOT 2 — ÉQUIPEMENTS", null, null, null, null, null],
  ["3", "Vanne papillon DN80", "U", 12, null, "à confirmer"],
  ["4", "Coffret de comptage", "U", "40", null, null],
  // Not a line: no number, and a quantity. Reported, not imported.
  [null, "TOTAL GÉNÉRAL", null, "2752.5", null, null],
];

const ERRATUM: (string | number | null)[][] = [
  ["1", "Fourniture et pose de canalisation DN200", "ml", "1 400", null, null],
  ["2", "Terrassement en tranchée", "m3", "1.500,5", null, null],
  ["3", "Vanne papillon DN100", "U", 12, null, null],
  // 4 withdrawn, 5 added.
  ["5", "Mise à la terre", "U", "8", null, null],
];

beforeAll(async () => {
  const [client] = await db
    .insert(party)
    .values({ code: `CL-TI${stamp}`, legalName: "TEST BPU IMPORT — SADEG" })
    .returning({ id: party.id });
  clientId = client?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });

  dealId = await createDeal(
    {
      partyId: clientId,
      subject: "Bordereau lu depuis un tableur",
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

  await makeTender({ dealId, procedure: "aonr", cautionPct: "1", actorId: ACTOR });
});

describe("reading the bordereau", () => {
  let batchId = "";

  it("finds the header row under the title and proposes the columns", async () => {
    const preview = await previewBpu({
      dealId,
      partyId: clientId,
      kind: "deal_line",
      filename: "BPU.xlsx",
      body: await bordereau(FIRST),
      actorId: ACTOR,
    });
    batchId = preview.batchId;

    expect(preview.headers).toEqual([
      "N° de prix",
      "Désignation",
      "Unité",
      "Quantité",
      "Prix unitaire",
      "Observations",
    ]);

    // Proposed, not remembered: this client has never confirmed one.
    expect(preview.remembered).toBe(false);
    expect(preview.mapping).toMatchObject({
      "N° de prix": "lineNumber",
      Désignation: "designation",
      Unité: "unit",
      Quantité: "quantity",
      "Prix unitaire": "unitPrice",
      // Nobody asked for it, so it is not guessed at.
      Observations: null,
    });
    expect(preview.missing).toEqual([]);
  });

  it("reads the quantities however the buyer wrote them", async () => {
    const preview = await loadBpuBatch(batchId);
    expect(preview?.read.lines.map((line) => [line.position, line.qty])).toEqual([
      [1, "1200"],
      [2, "1500.5"],
      [3, "12"],
      [4, "40"],
    ]);
  });

  it("passes over the section headings and reports only the total row", async () => {
    const preview = await loadBpuBatch(batchId);
    // Two `LOT …` rows carry neither a number nor a quantity: not lines, not
    // problems. The TOTAL row has a quantity and no number, so it is reported.
    expect(preview?.read.problems).toEqual([{ row: 10, reason: "noLineNumber" }]);
  });

  it("writes nothing until the mapping is confirmed", async () => {
    const before = await bpu(dealId);
    expect(before?.rows).toEqual([]);
    expect(before?.source).toBeNull();
  });

  it("turns the confirmed mapping into the deal's lines, and remembers it", async () => {
    const preview = await loadBpuBatch(batchId);
    await commitBpuBatch({
      batchId,
      partyId: clientId,
      mapping: preview?.mapping ?? {},
      actorId: ACTOR,
    });

    const view = await bpu(dealId);
    expect(view?.rows.map((row) => row.position)).toEqual([1, 2, 3, 4]);
    expect(view?.rows[0]?.designation).toBe("Fourniture et pose de canalisation DN200");
    expect(view?.rows[1]?.qty).toBe("1500.500");
    expect(view?.source).toBe("BPU.xlsx");

    const [row] = await db.select().from(tender).where(eq(tender.dealId, dealId));
    expect(row?.bpuImportedAt).not.toBeNull();

    expect(await rememberedMapping(clientId)).toMatchObject({ "N° de prix": "lineNumber" });
  });

  it("refuses a mapping missing one of the three columns that make it a bordereau", async () => {
    const preview = await previewBpu({
      dealId,
      partyId: clientId,
      kind: "bpu_erratum",
      filename: "BPU (2).xlsx",
      body: await bordereau(FIRST),
      actorId: ACTOR,
    });

    await expect(
      commitBpuBatch({
        batchId: preview.batchId,
        partyId: clientId,
        mapping: { "N° de prix": "lineNumber", Désignation: "designation" },
        actorId: ACTOR,
      }),
    ).rejects.toThrow(BpuUnreadable);
  });

  it("refuses a file with nothing in it", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("vide");
    const empty = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);

    await expect(
      previewBpu({
        dealId,
        partyId: clientId,
        kind: "bpu_erratum",
        filename: "vide.xlsx",
        body: empty,
        actorId: ACTOR,
      }),
    ).rejects.toThrow(BpuUnreadable);
  });
});

describe("the erratum, as a second spreadsheet", () => {
  it("uses the mapping this client already confirmed instead of guessing again", async () => {
    const preview = await previewBpu({
      dealId,
      partyId: clientId,
      kind: "bpu_erratum",
      filename: "ERRATUM.xlsx",
      body: await bordereau(ERRATUM),
      actorId: ACTOR,
    });

    expect(preview.remembered).toBe(true);
    expect(preview.read.lines.map((line) => line.position)).toEqual([1, 2, 3, 5]);

    await commitBpuBatch({
      batchId: preview.batchId,
      partyId: clientId,
      mapping: preview.mapping,
      actorId: ACTOR,
      receivedOn: "2026-08-14",
    });

    // Filed, and nothing has moved.
    const waiting = await pendingErratum(dealId);
    expect(waiting?.filename).toBe("ERRATUM.xlsx");
    expect(waiting?.receivedOn).toBe("2026-08-14");
    expect(waiting?.review.summary).toMatchObject({ added: 1, removed: 1, repriced: 1 });

    const lines = await db
      .select()
      .from(dealLine)
      .where(and(eq(dealLine.dealId, dealId), eq(dealLine.position, 4)));
    expect(lines).toHaveLength(1);
  });

  it("lists every file that has been read for this enquiry", async () => {
    const sources = await bpuSources(dealId);
    expect(sources.map((source) => source.filename)).toContain("BPU.xlsx");
    expect(sources.map((source) => source.filename)).toContain("ERRATUM.xlsx");

    const bordereauRow = sources.find((source) => source.filename === "BPU.xlsx");
    expect(bordereauRow?.becomes).toBe("deal_line");
    expect(bordereauRow?.status).toBe("imported");
    expect(bordereauRow?.rowsImported).toBe(4);
    // The TOTAL row, counted as skipped rather than quietly dropped.
    expect(bordereauRow?.rowsSkipped).toBe(1);
  });
});
