import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { inArray } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { extractionField, intakeDossier, intakePage } from "@/db/schema/dossier";
import { NEEDS, previewMode } from "@/domain/files/serving";
import { ingestDocument, loadReview } from "@/domain/intake/dossier";
import { buildZip } from "../helpers/zip";

/**
 * 1.7 — the document itself, beside the fields.
 *
 * LAW 2 asks a person to confirm a field AGAINST THE SOURCE. Screen 40 showed
 * `intake_page.text`, which is not the source — it is what a reader made of it,
 * and confirming a deadline against our own transcription proves only that the
 * transcription is self-consistent.
 *
 * The screen is a server component and its layout is not what these tests can
 * hold; what they hold is the contract it stands on. `loadReview` must say
 * WHERE the original is and WHAT it is, and `previewMode` — the same function
 * the serving route uses — must agree about which of them can be drawn, or the
 * screen offers a preview that arrives as a download.
 */

const stamp = Date.now().toString().slice(-6);
const ACTOR = "test-review-source";

async function cctpPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const lines of [
    [`REGLEMENT DE LA CONSULTATION ${stamp}`, "Article 1 - Objet du marche."],
    ["La date limite de depot des offres est fixee au 30/09/2026 a 10 heures 00."],
  ]) {
    const page = doc.addPage([595, 842]);
    let y = 780;
    for (const line of lines) {
      page.drawText(line, { x: 50, y, size: 11, font });
      y -= 18;
    }
  }
  return Buffer.from(await doc.save());
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

const CCTP_DOCX = buildZip([
  {
    name: "word/document.xml",
    body: Buffer.from(
      `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${p(
        "La date limite de dépôt des offres est fixée au 30/09/2026 à 10 heures 00.",
      )}</w:body></w:document>`,
      "utf8",
    ),
    method: 8,
  },
]);

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

describe("a PDF dossier can be shown, at the page its citation names", () => {
  it("carries where the original is and what it is", async () => {
    const { dossierId } = await ingestDocument({
      filename: `cctp-${stamp}.pdf`,
      body: await cctpPdf(),
      actorId: ACTOR,
    });
    created.push(dossierId);

    const review = await loadReview(dossierId);

    // Both are what the screen needs to draw the source at all: an href to the
    // bytes, and a type the route will send inline.
    expect(review?.storagePath).toBeTruthy();
    expect(review?.contentType).toBe("application/pdf");
    expect(previewMode(review?.contentType ?? null)).toBe("pdf");
  });

  it("cites a page the reader can actually be sent to", async () => {
    const review = await loadReview(created[0] as string);
    const deadline = review?.fields.find((f) => f.key === "submissionDeadline");

    // The screen opens the PDF at `#page=N` with N from here. A citation
    // pointing past the end of the document would send somebody to nothing.
    expect(deadline?.citation.page).toBe(2);
    expect(deadline?.citation.page).toBeLessThanOrEqual(review?.pages ?? 0);
  });

  it("puts the bytes behind the same permission the rest of the mailbox is behind", () => {
    // The viewer's src is `/api/files/dossier:<id>`, and raw correspondence is
    // `inbox.view` — not something the screen decides, and worth pinning here
    // because 1.7 is the first thing to point a frame at that route.
    expect(NEEDS.dossier).toBe("inbox.view");
  });
});

describe("a Word dossier is read but not drawable, and the screen must say so", () => {
  it("has an original and a type no browser renders in place", async () => {
    const { dossierId } = await ingestDocument({
      filename: `cctp-${stamp}.docx`,
      body: CCTP_DOCX,
      actorId: ACTOR,
    });
    created.push(dossierId);

    const review = await loadReview(dossierId);

    expect(review?.storagePath).toBeTruthy();
    // Which is exactly the case the screen falls back to text for. Offering a
    // preview here would open a frame that downloads the file instead — the
    // same containment `RENDERABLE` gives the route, read off the same set.
    expect(previewMode(review?.contentType ?? null)).toBeNull();
    // And the text IS there, so the fallback has something to show.
    expect(review?.fields.length).toBeGreaterThan(0);
  });
});
