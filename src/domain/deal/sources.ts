import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { deal } from "@/db/schema/deal";
import { intakeDossier, intakePage } from "@/db/schema/dossier";
import { intakeAttachment, intakeMessage } from "@/db/schema/intake";
import { fetchAttachmentFor } from "@/domain/intake/attachments";
import { dossierKindOf } from "@/domain/intake/dossier";
import { readAttachmentIntoDossier } from "@/domain/intake/reading";
import { type ParsedLine, type Paste, parsePaste } from "./paste";

/**
 * Screen 73 — WHERE the item list can be read from.
 *
 * "The ERP does not read anything because they have files, attachments, an
 * Excel file, some PDF, some Word files." That was the report, and it was
 * accurate about the ERP and wrong about the reason: every one of those files
 * was already being read. `readXlsx`, `readDocx` and `readTextLayer` have
 * turned attachments into `intake_page` rows since 1.6, and `parsePaste` has
 * read tab-separated rows and numbered lists since phase 4.
 *
 * The two halves had simply never been introduced. The only way text reached
 * the line table was a person selecting it in Outlook and pasting it into a
 * box — so a client who attached their bordereau instead of typing it got no
 * help at all, which is most clients.
 *
 * This file is the introduction, and nothing more than that. It reads; it
 * proposes; it writes nothing. LAW 2 — what comes back goes into a table the
 * person edits and then saves, and until they press save nothing has happened.
 */

/**
 * What can be read now, without asking the mailbox for anything.
 *
 *   ready        text is already stored. Pressing it is a database read.
 *   unread       the file has not been fetched or has not been read yet.
 *                Pressing it does both, which takes a moment and may fail
 *                honestly — a OneDrive link has no bytes to fetch.
 *   notReadable  an image, a .rar, a .doc from 2003. Named rather than hidden:
 *                a person looking for the bordereau needs to see that the ERP
 *                knows the file is there and cannot open it.
 */
export type SourceState = "ready" | "unread" | "notReadable";

export type LineSource = {
  /** `body`, or `file:<attachment id>`. */
  key: string;
  kind: "body" | "file";
  /** The file's own name, or the subject of the message. Never a translation. */
  label: string;
  state: SourceState;
  /** The extension, when that is the reason it cannot be read. */
  detail?: string;
};

export class SourceRefused extends Error {
  constructor(
    readonly reason:
      | "noSuchDeal"
      | "noSource"
      | "noBytes"
      | "notReadable"
      | "unreadable"
      | "nothingRead",
    readonly detail?: string,
  ) {
    super(reason);
    this.name = "SourceRefused";
  }
}

export type SourceReading = {
  label: string;
  lines: ParsedLine[];
  /** Lines that produced nothing. Counted on screen, never silently dropped. */
  ignored: string[];
  shape: Paste["shape"];
};

/**
 * Everything this enquiry could read its lines from.
 *
 * Empty when the enquiry was typed by hand rather than made from an email,
 * which is a normal state and not a fault — screen 73 then shows the paste box
 * and nothing else.
 */
export async function sourcesForDeal(dealId: string): Promise<LineSource[]> {
  const [message] = await db
    .select({
      id: intakeMessage.id,
      subject: intakeMessage.subject,
      bodyText: intakeMessage.bodyText,
    })
    .from(deal)
    .innerJoin(intakeMessage, eq(intakeMessage.id, deal.intakeMessageId))
    .where(eq(deal.id, dealId))
    .limit(1);

  if (!message) return [];

  const sources: LineSource[] = [];

  if ((message.bodyText ?? "").trim().length > 0) {
    sources.push({
      key: "body",
      kind: "body",
      label: message.subject?.trim() || "",
      state: "ready",
    });
  }

  const files = await db
    .select({
      id: intakeAttachment.id,
      filename: intakeAttachment.filename,
      contentType: intakeAttachment.contentType,
      storagePath: intakeAttachment.storagePath,
      dossierId: intakeDossier.id,
    })
    .from(intakeAttachment)
    // A left join: most attachments have never been read, and an attachment
    // that has not been read is exactly the one this screen exists to offer.
    .leftJoin(intakeDossier, eq(intakeDossier.attachmentId, intakeAttachment.id))
    .where(eq(intakeAttachment.messageId, message.id))
    .orderBy(asc(intakeAttachment.filename));

  for (const file of files) {
    const kind = dossierKindOf(file.filename, file.contentType);
    sources.push({
      key: `file:${file.id}`,
      kind: "file",
      label: file.filename,
      state: kind === null ? "notReadable" : file.dossierId ? "ready" : "unread",
      detail: kind === null ? (file.filename.split(".").pop() ?? "") : undefined,
    });
  }

  return sources;
}

/**
 * Read one source into proposed lines.
 *
 * Fetches and reads on demand. A person pressing "read this file" has decided
 * they want it now; making them wait for a background queue that runs every few
 * minutes — or that never ran, because the file arrived before the fetcher
 * existed — is the difference between a feature and a promise.
 */
export async function readLinesFrom(dealId: string, key: string): Promise<SourceReading> {
  const [message] = await db
    .select({
      id: intakeMessage.id,
      subject: intakeMessage.subject,
      bodyText: intakeMessage.bodyText,
    })
    .from(deal)
    .innerJoin(intakeMessage, eq(intakeMessage.id, deal.intakeMessageId))
    .where(eq(deal.id, dealId))
    .limit(1);

  if (!message) throw new SourceRefused("noSource");

  if (key === "body") {
    const read = parsePaste(message.bodyText ?? "");
    if (read.lines.length === 0) throw new SourceRefused("nothingRead");
    return { label: message.subject?.trim() || "", ...read };
  }

  if (!key.startsWith("file:")) throw new SourceRefused("noSource");
  return readFile(message.id, key.slice("file:".length));
}

/**
 * One attachment, from wherever it has got to.
 *
 * The attachment is looked up BY THE MESSAGE the deal came from, never by its
 * id alone. An id in a form field is a number a person can change, and every
 * attachment in this company's mail would otherwise be one edit away from
 * anybody who can open an enquiry.
 */
async function readFile(messageId: string, attachmentId: string): Promise<SourceReading> {
  const [file] = await db
    .select({
      id: intakeAttachment.id,
      filename: intakeAttachment.filename,
      contentType: intakeAttachment.contentType,
      storagePath: intakeAttachment.storagePath,
    })
    .from(intakeAttachment)
    .where(and(eq(intakeAttachment.id, attachmentId), eq(intakeAttachment.messageId, messageId)))
    .limit(1);

  if (!file) throw new SourceRefused("noSource");

  if (dossierKindOf(file.filename, file.contentType) === null) {
    throw new SourceRefused("notReadable", file.filename.split(".").pop() ?? "");
  }

  if (!file.storagePath) {
    const got = await fetchAttachmentFor(file.id);
    // `linked` is a OneDrive or SharePoint attachment: there is nothing in the
    // message to fetch and there never will be. `gone` is a row from before the
    // Graph id existed. Neither is worth a second press, so both say so.
    if (got.outcome !== "stored" && got.outcome !== "already") {
      throw new SourceRefused("noBytes", got.reason ?? got.outcome);
    }
  }

  const [already] = await db
    .select({ id: intakeDossier.id })
    .from(intakeDossier)
    .where(eq(intakeDossier.attachmentId, file.id))
    .limit(1);

  let dossierId = already?.id ?? null;

  if (!dossierId) {
    const read = await readAttachmentIntoDossier(file.id);
    if (read.outcome !== "read" && read.outcome !== "already") {
      throw new SourceRefused("unreadable", read.reason ?? read.outcome);
    }
    dossierId = read.dossierId ?? null;
  }

  if (!dossierId) throw new SourceRefused("unreadable");

  const pages = await db
    .select({ page: intakePage.page, text: intakePage.text })
    .from(intakePage)
    .where(eq(intakePage.dossierId, dossierId))
    .orderBy(asc(intakePage.page));

  const lines: ParsedLine[] = [];
  const ignored: string[] = [];
  let shape: Paste["shape"] = "empty";

  for (const page of pages) {
    const read = parsePaste(page.text);
    if (read.shape === "empty") continue;

    /*
      A PAGE OF PROSE IS PROSE, NOT A LIST.

      `parsePaste` lets bare lines be items when nothing on the page is
      numbered, bulleted or tabbed — right for an email, where a client may
      simply type three product names, and wrong for page 4 of a cahier des
      charges, where it would turn every sentence of the règlement into a line
      of the enquiry.

      A document page has to show its structure. If nothing on it is marked,
      nothing on it is a list.
    */
    if (read.shape === "prose" && read.lines.every((line) => line.readAs === "bare")) {
      continue;
    }

    for (const line of read.lines) lines.push({ ...line, position: lines.length + 1 });
    ignored.push(...read.ignored);
    if (shape === "empty") shape = read.shape;
  }

  if (lines.length === 0) throw new SourceRefused("nothingRead");

  return { label: file.filename, lines, ignored, shape };
}
