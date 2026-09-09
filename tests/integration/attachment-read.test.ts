import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { extractionField, intakeDossier, intakePage } from "@/db/schema/dossier";
import { intakeAttachment, intakeMessage } from "@/db/schema/intake";
import { storagePathFor } from "@/domain/intake/attachments";
import { messageDetail } from "@/domain/intake/message";
import { readAttachmentIntoDossier } from "@/domain/intake/reading";
import { storageFor } from "@/storage";

/**
 * 1.8 — a tender dossier that arrives by email is read without anybody
 * uploading it.
 *
 * `ingestDocument` has accepted `messageId` and `attachmentId` since it was
 * written and `intake_dossier` has carried both foreign keys, and NOTHING ever
 * passed them: the only way a CCTP was ever read was for a person to download
 * it from Outlook and upload it again on screen 39. This is the caller.
 *
 * LAW 2 runs through all of it: reading proposes, and every field it produces
 * stays `proposed` until a person confirms it against the source.
 */

const stamp = Date.now().toString().slice(-6);

async function cctp(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  let y = 780;
  for (const line of [
    `AVIS D APPEL D OFFRES ${stamp}`,
    "La date limite de depot des offres est fixee au 30/09/2026 a 10 heures 00.",
  ]) {
    page.drawText(line, { x: 50, y, size: 11, font });
    y -= 20;
  }
  return Buffer.from(await doc.save());
}

let messageId = "";
let pdfId = "";
let imageId = "";
let emptyId = "";

beforeAll(async () => {
  const [message] = await db
    .insert(intakeMessage)
    .values({
      channelKey: "mailbox",
      externalId: `graph-msg-read-${stamp}`,
      receivedAt: new Date(),
      fromAddress: `client-${stamp}@example.test`,
      subject: `Consultation ${stamp}`,
      status: "needs_review",
    })
    .returning({ id: intakeMessage.id });

  messageId = message?.id as string;

  const [a, b, c] = await db
    .insert(intakeAttachment)
    .values([
      { messageId, filename: `cctp-${stamp}.pdf`, contentType: "application/pdf" },
      { messageId, filename: `photo-${stamp}.png`, contentType: "image/png" },
      { messageId, filename: `annexe-${stamp}.pdf`, contentType: "application/pdf" },
    ])
    .returning({ id: intakeAttachment.id });

  pdfId = a?.id as string;
  imageId = b?.id as string;
  emptyId = c?.id as string;

  // The first two have bytes, where the fetcher put them. The third has none —
  // a reference attachment, or a fetch that has not run yet.
  const store = storageFor("working");
  const pdfPath = storagePathFor(pdfId, `cctp-${stamp}.pdf`);
  await store.put({ path: pdfPath, body: await cctp(), mime: "application/pdf" });
  await db
    .update(intakeAttachment)
    .set({ storagePath: pdfPath })
    .where(eq(intakeAttachment.id, pdfId));

  const imagePath = storagePathFor(imageId, `photo-${stamp}.png`);
  await store.put({ path: imagePath, body: Buffer.from("not really a png"), mime: "image/png" });
  await db
    .update(intakeAttachment)
    .set({ storagePath: imagePath })
    .where(eq(intakeAttachment.id, imageId));
});

afterAll(async () => {
  if (!messageId) return;

  const attachments = await db
    .select({ id: intakeAttachment.id })
    .from(intakeAttachment)
    .where(eq(intakeAttachment.messageId, messageId));

  const dossiers = await db
    .select({ id: intakeDossier.id })
    .from(intakeDossier)
    .where(eq(intakeDossier.messageId, messageId));

  const base = process.env.STORAGE_LOCAL_PATH ?? resolve(process.cwd(), ".data", "files");
  for (const row of attachments) {
    await rm(resolve(base, "attachments", row.id), { recursive: true, force: true });
  }

  const dossierIds = dossiers.map((d) => d.id);
  if (dossierIds.length > 0) {
    const fields = await db
      .select({ id: extractionField.id })
      .from(extractionField)
      .where(inArray(extractionField.dossierId, dossierIds));

    await db.delete(auditEntry).where(
      inArray(
        auditEntry.entityId,
        fields.map((f) => f.id),
      ),
    );
    await db.delete(extractionField).where(inArray(extractionField.dossierId, dossierIds));
    await db.delete(intakePage).where(inArray(intakePage.dossierId, dossierIds));
    await db.delete(intakeDossier).where(inArray(intakeDossier.id, dossierIds));
    await db.delete(auditEntry).where(inArray(auditEntry.entityId, dossierIds));
  }

  await db.delete(auditEntry).where(
    inArray(
      auditEntry.entityId,
      attachments.map((a) => a.id),
    ),
  );
  await db.delete(auditEntry).where(eq(auditEntry.entityId, messageId));
  await db.delete(intakeMessage).where(eq(intakeMessage.id, messageId));
});

describe("a CCTP that arrived by email", () => {
  it("becomes a reviewable dossier with nobody uploading anything", async () => {
    const result = await readAttachmentIntoDossier(pdfId);

    expect(result.outcome).toBe("read");
    expect(result.fields).toBeGreaterThan(0);

    const [dossier] = await db
      .select()
      .from(intakeDossier)
      .where(eq(intakeDossier.id, result.dossierId as string));

    // Both foreign keys, at last written by something: the dossier knows which
    // message and which file it came from, which is what makes it findable
    // from the screen the mail landed on.
    expect(dossier?.messageId).toBe(messageId);
    expect(dossier?.attachmentId).toBe(pdfId);
    expect(dossier?.status).toBe("review");
  });

  it("proposes the deadline and confirms nothing", async () => {
    const [dossier] = await db
      .select({ id: intakeDossier.id })
      .from(intakeDossier)
      .where(eq(intakeDossier.attachmentId, pdfId));

    const fields = await db
      .select()
      .from(extractionField)
      .where(eq(extractionField.dossierId, dossier?.id as string));

    const deadline = fields.find((f) => f.key === "submissionDeadline");
    expect(deadline?.value).toContain("2026-09-30");
    // LAW 2. Reading is not deciding, whoever did the reading.
    expect(deadline?.status).toBe("proposed");
    expect(deadline?.confirmedAt).toBeNull();
  });

  it("keeps ONE copy of the bytes", async () => {
    const [attachment] = await db
      .select({ path: intakeAttachment.storagePath })
      .from(intakeAttachment)
      .where(eq(intakeAttachment.id, pdfId));

    const [dossier] = await db
      .select({ path: intakeDossier.storagePath })
      .from(intakeDossier)
      .where(eq(intakeDossier.attachmentId, pdfId));

    // The fetcher already put the file in the working store. A second copy per
    // dossier, on a mini PC, buys nothing: nothing edits either one and the
    // same route serves both.
    expect(dossier?.path).toBe(attachment?.path);
  });

  it("is reachable from the message it arrived on", async () => {
    const detail = await messageDetail(messageId);
    const file = detail?.attachments.find((a) => a.id === pdfId);

    // Screen 39's list is a log, not a route. Without this link an extraction
    // is something that happened where nobody was looking.
    expect(file?.dossierId).toBeTruthy();
    expect(detail?.attachments.find((a) => a.id === imageId)?.dossierId).toBeNull();
  });

  it("does not read the same file twice when the job is delivered twice", async () => {
    const again = await readAttachmentIntoDossier(pdfId);
    expect(again.outcome).toBe("already");

    const rows = await db
      .select({ id: intakeDossier.id })
      .from(intakeDossier)
      .where(eq(intakeDossier.attachmentId, pdfId));
    expect(rows).toHaveLength(1);
  });
});

describe("what it declines to read, and says so", () => {
  it("names an image rather than failing on it", async () => {
    // Until the OCR container exists (1.9) a photograph has no text to read.
    // Not a failure — nothing will make it readable, so nothing retries it.
    const result = await readAttachmentIntoDossier(imageId);
    expect(result.outcome).toBe("notReadable");
    expect(result.reason).toBe("png");
  });

  it("waits for a file whose copy is not here yet", async () => {
    const result = await readAttachmentIntoDossier(emptyId);
    expect(result.outcome).toBe("noBytes");
  });

  it("says gone for a row that was dismissed while the job waited", async () => {
    const result = await readAttachmentIntoDossier("00000000-0000-4000-8000-000000000000");
    expect(result.outcome).toBe("gone");
  });
});
