import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { asc, eq, inArray } from "drizzle-orm";
import { Workbook } from "exceljs";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { extractionField, intakeDossier, intakePage } from "@/db/schema/dossier";
import { listFiles } from "@/domain/files";
import { dossierKindOf, ingestDocument, UnreadableKind } from "@/domain/intake/dossier";
import { buildZip } from "../helpers/zip";

/**
 * 1.6 — a Word or Excel file becomes a reviewable dossier.
 *
 * The readers are unit-tested on their own (`tests/unit/office-text.test.ts`).
 * What is proven here is the claim the task actually makes: that a DOCX and an
 * XLSX produce the SAME `intake_page` rows and the same proposed fields with
 * citations that a PDF produces — so screen 40 works on all three without
 * knowing which one it is looking at.
 */

const stamp = Date.now().toString().slice(-6);
const ACTOR = "test-office-ingest";

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

const CCTP = buildZip([
  {
    name: "word/document.xml",
    body: Buffer.from(
      `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${[
        p(`RÈGLEMENT DE LA CONSULTATION ${stamp}`),
        p("La date limite de dépôt des offres est fixée au 30/09/2026 à 10 heures 00."),
        p("L'ouverture des plis aura lieu le 30/09/2026 à 14 heures 00."),
      ].join("")}</w:body></w:document>`,
      "utf8",
    ),
    method: 8,
  },
]);

async function priceList(): Promise<Buffer> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Bordereau");
  sheet.addRow(["Désignation", "Unité", "Quantité", "Prix unitaire"]);
  sheet.addRow([`Câble U1000 R2V 3G2.5 ${stamp}`, "ml", 1200, 480]);
  sheet.addRow(["Disjoncteur 63A", "u", 14, 12_500]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const created: string[] = [];

afterAll(async () => {
  if (created.length === 0) return;

  const base = process.env.STORAGE_LOCAL_PATH ?? resolve(process.cwd(), ".data", "files");
  for (const id of created) {
    await rm(resolve(base, "dossiers", id), { recursive: true, force: true });
  }

  const fields = await db
    .select({ id: extractionField.id })
    .from(extractionField)
    .where(inArray(extractionField.dossierId, created));

  await db
    .delete(auditEntry)
    .where(inArray(auditEntry.entityId, created.concat(fields.map((f) => f.id))));
  await db.delete(extractionField).where(inArray(extractionField.dossierId, created));
  await db.delete(intakePage).where(inArray(intakePage.dossierId, created));
  await db.delete(intakeDossier).where(inArray(intakeDossier.id, created));
});

describe("which reader a filename asks for", () => {
  it("names the three kinds that can be read, and refuses to guess at the rest", () => {
    expect(dossierKindOf("cctp.pdf", null)).toBe("pdf");
    expect(dossierKindOf("cctp.docx", null)).toBe("docx");
    expect(dossierKindOf("bordereau.xlsx", null)).toBe("xlsx");
    expect(dossierKindOf("plans.dwg", null)).toBeNull();
    expect(dossierKindOf("scan.jpg", "image/jpeg")).toBeNull();
  });
});

describe("a Word CCTP", () => {
  it("becomes pages of text and proposes fields with the page they came from", async () => {
    const result = await ingestDocument({
      filename: `cctp-${stamp}.docx`,
      body: CCTP,
      actorId: ACTOR,
    });
    created.push(result.dossierId);

    const pages = await db
      .select()
      .from(intakePage)
      .where(eq(intakePage.dossierId, result.dossierId))
      .orderBy(asc(intakePage.page));

    expect(pages).toHaveLength(1);
    expect(pages[0]?.text).toContain("date limite de dépôt");

    // The whole point of 1.6: the same extraction, on text from a different
    // reader, with a citation a person can check against the source.
    const fields = await db
      .select()
      .from(extractionField)
      .where(eq(extractionField.dossierId, result.dossierId));

    const deadline = fields.find((f) => f.key === "submissionDeadline");
    expect(deadline?.value).toContain("2026-09-30");
    expect(deadline?.citationPage).toBe(1);
    expect(deadline?.citationQuote).toContain("30/09/2026");

    // LAW 2: read, not true. Nothing is confirmed by having been read.
    expect(deadline?.status).toBe("proposed");
    expect(deadline?.confirmedAt).toBeNull();
  });

  it("records which reader read it, and what the bytes were stored as", async () => {
    const [row] = await db
      .select()
      .from(intakeDossier)
      .where(eq(intakeDossier.id, created[0] as string));

    expect(row?.provider).toBe("docx");
    expect(row?.status).toBe("review");
    expect(row?.locale).toBe("fr");
    // Screen 60 used to state `application/pdf` for every dossier. The writer
    // says it now, on the row, because it is no longer always true.
    expect(row?.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });
});

describe("an Excel price list", () => {
  it("becomes one page per sheet, with the rows readable", async () => {
    const result = await ingestDocument({
      filename: `bordereau-${stamp}.xlsx`,
      body: await priceList(),
      actorId: ACTOR,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    created.push(result.dossierId);

    const pages = await db
      .select()
      .from(intakePage)
      .where(eq(intakePage.dossierId, result.dossierId));

    expect(pages).toHaveLength(1);
    expect(pages[0]?.text).toContain("Bordereau");
    expect(pages[0]?.text).toContain(`Câble U1000 R2V 3G2.5 ${stamp}`);
    // A row stays a row: the quantity beside its designation, which is the
    // only form in which a bordereau means anything.
    expect(pages[0]?.text).toContain("ml\t1200");
  });

  it("is listed on the files screen as the spreadsheet it is", async () => {
    const rows = await listFiles();
    const mine = rows.find((row) => row.filename === `bordereau-${stamp}.xlsx`);

    expect(mine?.kind).toBe("dossier");
    expect(mine?.state).toBe("stored");
    expect(mine?.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });
});

describe("a kind nothing here can read", () => {
  it("writes no row and stores no bytes", async () => {
    const before = await db.select({ id: intakeDossier.id }).from(intakeDossier);

    await expect(
      ingestDocument({ filename: "plans.dwg", body: Buffer.from("AC1027"), actorId: ACTOR }),
    ).rejects.toBeInstanceOf(UnreadableKind);

    // A file this cannot read is not a dossier that failed — it is a file that
    // was never a dossier, and a row saying otherwise would sit on screen 39
    // for ever inviting somebody to review nothing.
    const after = await db.select({ id: intakeDossier.id }).from(intakeDossier);
    expect(after).toHaveLength(before.length);
  });
});
