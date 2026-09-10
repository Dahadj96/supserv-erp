import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { Workbook } from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { XLSX_MIME } from "@/capture/ocr/office";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine } from "@/db/schema/deal";
import { intakeDossier, intakePage } from "@/db/schema/dossier";
import { intakeAttachment, intakeMessage } from "@/db/schema/intake";
import { party, partyRole } from "@/db/schema/party";
import { createDeal } from "@/domain/deal/deal";
import { readLinesFrom, SourceRefused, sourcesForDeal } from "@/domain/deal/sources";
import { storagePathFor } from "@/domain/intake/attachments";
import { storageFor } from "@/storage";

/**
 * Screen 73 — reading the list out of what the client actually sent.
 *
 * "A lot of clients, when they send an RFQ by email, will give you a list — an
 * Excel list, or an image, or they type it in the email, or they have a PDF."
 * That is the whole of this test. The Excel file is the commonest of them and
 * is the one exercised end to end here: a real .xlsx, written by exceljs, put
 * where the fetcher puts an attachment, and read into proposed lines by nothing
 * but a person pressing a button.
 *
 * The readers themselves were already tested (1.6). What was missing, and what
 * this covers, is that anything at all connected them to `deal_line`.
 */

const ACTOR = "test-line-sources-actor";
const stamp = Date.now().toString().slice(-6);

let clientId = "";
let messageId = "";
let dealId = "";
let sheetId = "";
let imageId = "";

/** A bordereau as a client sends it: a title row, a header row, then the items. */
async function bordereau(): Promise<Buffer> {
  const book = new Workbook();
  const sheet = book.addWorksheet("Bordereau");
  sheet.addRow(["DEMANDE DE PRIX"]);
  sheet.addRow(["Référence", "Désignation", "Qté", "Unité"]);
  sheet.addRow(["VP-DN80-16", "Vanne papillon DN80 PN16", 12, "pc"]);
  sheet.addRow(["RAC-BR-2", "Raccord à brides 2 pouces", 40, "pc"]);
  sheet.addRow(["JT-EPDM-80", "Joint EPDM DN80", 24, "pc"]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

beforeAll(async () => {
  const [client] = await db
    .insert(party)
    .values({ code: `CL-S9${stamp.slice(-5)}`, legalName: `GROUPEMENT SOURCE ${stamp}` })
    .returning({ id: party.id });
  clientId = client?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });

  const [message] = await db
    .insert(intakeMessage)
    .values({
      channelKey: "mailbox",
      externalId: `graph-msg-src-${stamp}`,
      receivedAt: new Date(),
      fromAddress: `achats-${stamp}@example.test`,
      subject: `Consultation ${stamp}`,
      // The other shape: the client types the list into the body.
      bodyText: [
        "Bonjour,",
        "Merci de nous faire parvenir votre meilleure offre pour :",
        "1. VP-DN80-16 Vanne papillon DN80 PN16 — 12 pc",
        "2. RAC-BR-2 Raccord à brides 2 pouces — 40 pc",
        "Cordialement",
      ].join("\n"),
      status: "needs_review",
    })
    .returning({ id: intakeMessage.id });
  messageId = message?.id as string;

  const [sheetRow, imageRow] = await db
    .insert(intakeAttachment)
    .values([
      { messageId, filename: `bordereau-${stamp}.xlsx`, contentType: XLSX_MIME },
      { messageId, filename: `liste-${stamp}.jpg`, contentType: "image/jpeg" },
    ])
    .returning({ id: intakeAttachment.id });
  sheetId = sheetRow?.id as string;
  imageId = imageRow?.id as string;

  const path = storagePathFor(sheetId, `bordereau-${stamp}.xlsx`);
  await storageFor("working").put({ path, body: await bordereau(), mime: XLSX_MIME });
  await db
    .update(intakeAttachment)
    .set({ storagePath: path })
    .where(eq(intakeAttachment.id, sheetId));

  dealId = await createDeal(
    {
      partyId: clientId,
      subject: `Consultation ${stamp}`,
      contactPersonId: null,
      clientReference: null,
      receivedAt: new Date(),
      deadlineAt: null,
      submissionMethod: "email",
      currency: "DZD",
      ownerId: null,
      source: "mailbox",
      intakeMessageId: messageId,
      expectedValue: null,
      clientInstructions: null,
    },
    ACTOR,
  );
});

afterAll(async () => {
  if (dealId) {
    await db.delete(dealLine).where(eq(dealLine.dealId, dealId));
    await db.delete(deal).where(eq(deal.id, dealId));
  }
  if (messageId) {
    const dossiers = await db
      .select({ id: intakeDossier.id })
      .from(intakeDossier)
      .where(eq(intakeDossier.messageId, messageId));
    const ids = dossiers.map((d) => d.id);
    if (ids.length > 0) {
      await db.delete(intakePage).where(inArray(intakePage.dossierId, ids));
      await db.delete(intakeDossier).where(inArray(intakeDossier.id, ids));
      await db.delete(auditEntry).where(inArray(auditEntry.entityId, ids));
    }
    const base = process.env.STORAGE_LOCAL_PATH ?? resolve(process.cwd(), ".data", "files");
    for (const id of [sheetId, imageId]) {
      if (id) await rm(resolve(base, "attachments", id), { recursive: true, force: true });
    }
    await db.delete(auditEntry).where(inArray(auditEntry.entityId, [sheetId, imageId]));
    await db.delete(intakeMessage).where(eq(intakeMessage.id, messageId));
  }
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  if (clientId) {
    await db.delete(partyRole).where(eq(partyRole.partyId, clientId));
    await db.delete(party).where(eq(party.id, clientId));
  }
});

describe("what an enquiry can read its list from", () => {
  it("offers the email and every file, and names the one it cannot open", async () => {
    const sources = await sourcesForDeal(dealId);

    const body = sources.find((s) => s.key === "body");
    expect(body?.state).toBe("ready");

    const sheet = sources.find((s) => s.key === `file:${sheetId}`);
    // The bytes are here; nothing has read them yet. Pressing does both.
    expect(sheet?.state).toBe("unread");
    expect(sheet?.label).toBe(`bordereau-${stamp}.xlsx`);

    const image = sources.find((s) => s.key === `file:${imageId}`);
    // LISTED, not hidden. A person hunting for the bordereau has to see that
    // the ERP knows the photograph is there and cannot read it.
    expect(image?.state).toBe("notReadable");
    expect(image?.detail).toBe("jpg");
  });

  it("has nothing to offer on an enquiry that was typed in by hand", async () => {
    const typed = await createDeal(
      {
        partyId: clientId,
        subject: "Saisie à la main",
        contactPersonId: null,
        clientReference: null,
        receivedAt: new Date(),
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

    expect(await sourcesForDeal(typed)).toEqual([]);
    await db.delete(deal).where(eq(deal.id, typed));
  });
});

describe("the client's Excel file", () => {
  it("becomes proposed lines, with the header row left out", async () => {
    const read = await readLinesFrom(dealId, `file:${sheetId}`);

    expect(read.label).toBe(`bordereau-${stamp}.xlsx`);
    expect(read.shape).toBe("tabs");
    expect(read.lines.map((l) => l.designation)).toEqual([
      "Vanne papillon DN80 PN16",
      "Raccord à brides 2 pouces",
      "Joint EPDM DN80",
    ]);
    expect(read.lines.map((l) => l.reference)).toEqual(["VP-DN80-16", "RAC-BR-2", "JT-EPDM-80"]);
    expect(read.lines.map((l) => l.qty)).toEqual(["12", "40", "24"]);
    expect(read.lines.every((l) => l.unit === "pc")).toBe(true);
    // LAW 2. Reading proposes; nothing is on the enquiry until a person saves.
    expect(await db.select().from(dealLine).where(eq(dealLine.dealId, dealId))).toHaveLength(0);
  });

  it("does not read the same file twice", async () => {
    await readLinesFrom(dealId, `file:${sheetId}`);
    const dossiers = await db
      .select({ id: intakeDossier.id })
      .from(intakeDossier)
      .where(eq(intakeDossier.attachmentId, sheetId));
    expect(dossiers).toHaveLength(1);
  });

  it("says what it cannot do rather than failing quietly", async () => {
    await expect(readLinesFrom(dealId, `file:${imageId}`)).rejects.toMatchObject({
      reason: "notReadable",
      detail: "jpg",
    });
  });

  it("refuses a file that belongs to somebody else's message", async () => {
    const [other] = await db
      .insert(intakeMessage)
      .values({
        channelKey: "mailbox",
        externalId: `graph-msg-other-${stamp}`,
        receivedAt: new Date(),
        status: "needs_review",
      })
      .returning({ id: intakeMessage.id });

    const [stranger] = await db
      .insert(intakeAttachment)
      .values({ messageId: other?.id as string, filename: "prix.xlsx", contentType: XLSX_MIME })
      .returning({ id: intakeAttachment.id });

    // An id in a form field is a number a person can change. Every attachment
    // in the company's mail must not be one edit away from anybody who can
    // open an enquiry.
    await expect(readLinesFrom(dealId, `file:${stranger?.id}`)).rejects.toBeInstanceOf(
      SourceRefused,
    );

    await db.delete(intakeAttachment).where(eq(intakeAttachment.id, stranger?.id as string));
    await db.delete(intakeMessage).where(eq(intakeMessage.id, other?.id as string));
  });
});

describe("the list typed into the email", () => {
  it("reads the numbered lines and leaves the greeting out", async () => {
    const read = await readLinesFrom(dealId, "body");

    expect(read.lines.map((l) => l.designation)).toEqual([
      "Vanne papillon DN80 PN16",
      "Raccord à brides 2 pouces",
    ]);
    expect(read.lines.map((l) => l.qty)).toEqual(["12", "40"]);
    // "Bonjour", "Merci de nous faire parvenir…" and "Cordialement" are not
    // items, and they are reported rather than dropped in silence.
    expect(read.ignored).toHaveLength(3);
  });
});
