import { and, asc, eq } from "drizzle-orm";
import { DOCX_MIME, officeKind, readDocx, readXlsx, XLSX_MIME } from "@/capture/ocr/office";
import { NeedsOcr, REVIEW_THRESHOLD } from "@/capture/ocr/provider";
import { readTextLayer, type TextLayer } from "@/capture/ocr/text-layer";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { extractionField, intakeDossier, intakePage } from "@/db/schema/dossier";
import { storageFor } from "@/storage";
import { type FieldKey, highConfidence, proposeFields } from "./extract";

/**
 * Screens 39 and 40 — reading a document, then confirming what was read.
 *
 * Nothing in this file decides anything. It reads, proposes, and records what a
 * person decided. The gap between those two sentences is LAW 2.
 */

export function storagePathFor(dossierId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return `dossiers/${dossierId}/${safe}`;
}

/**
 * What this file can read, and what each one is stored as.
 *
 * A dossier's bytes are served back to the browser (screen 60, and 1.5's
 * viewer), so the type recorded here is the type that route will declare. It is
 * written on the row rather than assumed by the reader: `dossierFiles()` used to
 * say `application/pdf` for every dossier on the grounds that `ingestPdf` was
 * the only writer and put it there — true until this task, and the kind of
 * claim that goes quietly wrong the day it stops being true.
 */
const READABLE: Record<string, { mime: string; read: (file: Buffer) => Promise<TextLayer> }> = {
  pdf: { mime: "application/pdf", read: readTextLayer },
  docx: { mime: DOCX_MIME, read: readDocx },
  xlsx: { mime: XLSX_MIME, read: readXlsx },
};

export type DossierKind = keyof typeof READABLE;

/**
 * Which reader a file needs, from its name and whatever type came with it.
 *
 * Null means nothing here can read it — a .doc from 2003, a .rar, an image.
 * The caller decides what to do about that; this function does not guess.
 */
export function dossierKindOf(filename: string, mime?: string | null): DossierKind | null {
  const name = filename.toLowerCase();
  const type = (mime ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (name.endsWith(".pdf") || type === "application/pdf" || type === "application/x-pdf") {
    return "pdf";
  }
  return officeKind(filename, mime ?? null);
}

/** Thrown when a file is not one of the three kinds above. */
export class UnreadableKind extends Error {
  constructor(readonly filename: string) {
    super("unreadableKind");
    this.name = "UnreadableKind";
  }
}

/**
 * Take in a document: store it, read it, propose fields.
 *
 * PDF, Word and Excel, through one path — because everything after the reading
 * is identical, and that is the point of 1.6: `intake_page`, `proposeFields`,
 * screen 40 and its citations never learn which reader produced the text.
 *
 * A dossier whose pages could not all be read is still created, still
 * reviewable, and says which pages it could not read. Refusing the whole file
 * because page 7 is a scan would leave the other thirteen pages unread too.
 */
export async function ingestDocument(opts: {
  filename: string;
  body: Buffer;
  actorId: string;
  /** What the file said it was, when something declared it. */
  mime?: string | null;
  messageId?: string;
  attachmentId?: string;
  /**
   * Where the bytes ALREADY are, when something else stored them first.
   *
   * An attachment read automatically (1.8) has been in the working store since
   * the fetcher put it there, and copying it to `dossiers/<id>/` would keep a
   * second copy of every dossier this company is ever sent, on a mini PC, for
   * no gain: nothing edits either copy, and both are served by the same route.
   * The dossier points at the attachment's own path instead.
   *
   * Two rows claiming one file is not a lie and screen 66 reads it correctly —
   * what that screen looks for is the opposite, a file no row claims.
   */
  storagePath?: string;
}): Promise<{ dossierId: string; fields: number; unreadPages: number[] }> {
  const kind = dossierKindOf(opts.filename, opts.mime);
  // Nothing is stored and no row is written: a file this cannot read is not a
  // dossier that failed, it is a file that was never a dossier.
  if (!kind) throw new UnreadableKind(opts.filename);

  const format = READABLE[kind] as (typeof READABLE)[string];

  const [row] = await db
    .insert(intakeDossier)
    .values({
      filename: opts.filename,
      storagePath: "",
      contentType: format.mime,
      messageId: opts.messageId ?? null,
      attachmentId: opts.attachmentId ?? null,
      status: "reading",
    })
    .returning({ id: intakeDossier.id });

  const dossierId = row?.id as string;
  const path = opts.storagePath ?? storagePathFor(dossierId, opts.filename);

  if (!opts.storagePath) {
    await storageFor("working").put({ path, body: opts.body, mime: format.mime });
  }

  let unreadPages: number[] = [];
  let provider = kind === "pdf" ? "text-layer" : kind;

  // A file that turns out not to be what its name claimed — a scanner set to
  // JPEG, a .docx that is really a .doc, a download that stopped halfway — must
  // not leave a dossier sitting in `reading` for ever. The row is marked failed
  // and the error is re-thrown so the caller can leave the file where the
  // person put it.
  let layer: TextLayer;
  try {
    layer = await format.read(opts.body);
  } catch (error) {
    await db
      .update(intakeDossier)
      .set({ storagePath: path, status: "failed" })
      .where(eq(intakeDossier.id, dossierId));

    await db.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "system",
      entity: "intake_dossier",
      entityId: dossierId,
      action: "unreadable",
      after: {
        filename: opts.filename,
        kind,
        error: error instanceof Error ? error.message : "unknown",
      },
      sourceScreen: "39",
    });

    throw error;
  }

  if (layer.thinPages.length > 0 || layer.needsBidi) {
    // The OCR container is not on this machine yet (docs/OCR.md). The pages
    // that DID read are kept and reviewable; the rest are named.
    unreadPages = layer.thinPages;
    provider = `${provider}-partial`;
  }

  if (layer.pages.length > 0) {
    await db
      .insert(intakePage)
      .values(layer.pages.map((p) => ({ dossierId, page: p.page, text: p.text })));
  }

  const proposed = proposeFields(layer.pages);
  if (proposed.length > 0) {
    await db.insert(extractionField).values(
      proposed.map((f) => ({
        dossierId,
        key: f.key,
        value: f.value,
        display: f.display,
        confidence: f.confidence.toFixed(3),
        caveat: f.caveat,
        citationPage: f.citation.page,
        citationQuote: f.citation.quote,
        citationArticle: f.citation.article,
      })),
    );
  }

  await db
    .update(intakeDossier)
    .set({
      storagePath: path,
      pages: layer.totalPages,
      provider,
      locale: guessLocaleOf(layer.pages.map((p) => p.text).join(" ")),
      unreadPages,
      status: "review",
    })
    .where(eq(intakeDossier.id, dossierId));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "system",
    entity: "intake_dossier",
    entityId: dossierId,
    action: "read",
    after: {
      filename: opts.filename,
      pages: layer.totalPages,
      provider,
      unreadPages,
      proposed: proposed.length,
    },
    sourceScreen: "39",
  });

  return { dossierId, fields: proposed.length, unreadPages };
}

function guessLocaleOf(sample: string): string | null {
  if (/[؀-ۿ]/.test(sample)) return "ar";
  const fr = (sample.toLowerCase().match(/\b(le|la|les|des|du|article|offre|march[ée])\b/g) ?? [])
    .length;
  const en = (sample.toLowerCase().match(/\b(the|of|shall|tender|offer)\b/g) ?? []).length;
  if (fr === 0 && en === 0) return null;
  return fr >= en ? "fr" : "en";
}

/** Re-export so a caller does not have to know which module owns the number. */
export { NeedsOcr, REVIEW_THRESHOLD };

export type ReviewField = {
  id: string;
  key: FieldKey;
  value: string;
  display: string;
  confidence: number;
  caveat: string | null;
  citation: { page: number; quote: string; article: string | null };
  status: string;
  confirmedValue: string | null;
};

export type Review = {
  id: string;
  filename: string;
  pages: number;
  provider: string | null;
  locale: string | null;
  unreadPages: number[];
  status: string;
  /**
   * Whether the ORIGINAL is here, and what it is — so screen 40 can put the
   * document itself beside the fields instead of only our transcription of it.
   * LAW 2 asks a person to confirm a field against the source, and page text
   * is not the source, it is what a reader made of it.
   */
  storagePath: string | null;
  contentType: string | null;
  fields: ReviewField[];
  /** Screen 40's "field 3 of 24". */
  confirmedCount: number;
  /**
   * The deal these readings have already been carried onto, when somebody has
   * carried them (task 2.4). Null is the ordinary state and means the last
   * arrow of the pipeline has not been walked yet.
   */
  dealId: string | null;
};

export async function loadReview(dossierId: string): Promise<Review | null> {
  const [dossier] = await db
    .select()
    .from(intakeDossier)
    .where(eq(intakeDossier.id, dossierId))
    .limit(1);
  if (!dossier) return null;

  const rows = await db
    .select()
    .from(extractionField)
    .where(eq(extractionField.dossierId, dossierId))
    .orderBy(asc(extractionField.citationPage), asc(extractionField.key));

  const fields: ReviewField[] = rows.map((r) => ({
    id: r.id,
    key: r.key as FieldKey,
    value: r.value,
    display: r.display,
    confidence: Number(r.confidence),
    caveat: r.caveat,
    citation: { page: r.citationPage, quote: r.citationQuote, article: r.citationArticle },
    status: r.status,
    confirmedValue: r.confirmedValue,
  }));

  return {
    id: dossier.id,
    filename: dossier.filename,
    pages: dossier.pages,
    provider: dossier.provider,
    locale: dossier.locale,
    unreadPages: (dossier.unreadPages as number[]) ?? [],
    status: dossier.status,
    // Empty string is what the row carries between the insert and the store.
    storagePath: dossier.storagePath || null,
    contentType: dossier.contentType,
    fields,
    confirmedCount: fields.filter((f) => f.status === "confirmed" || f.status === "corrected")
      .length,
    dealId: dossier.dealId,
  };
}

export async function pageText(dossierId: string, page: number): Promise<string | null> {
  const [row] = await db
    .select({ text: intakePage.text })
    .from(intakePage)
    .where(and(eq(intakePage.dossierId, dossierId), eq(intakePage.page, page)))
    .limit(1);
  return row?.text ?? null;
}

/**
 * Confirm one field.
 *
 * `value` is never touched. If the person typed something different, that is a
 * CORRECTION and is recorded as one — because "the machine read X, the person
 * said Y" is a fact worth keeping, and "the field says Y" is not.
 */
export async function confirmField(opts: {
  fieldId: string;
  actorId: string;
  correctedTo?: string;
}) {
  const [field] = await db
    .select()
    .from(extractionField)
    .where(eq(extractionField.id, opts.fieldId))
    .limit(1);
  if (!field) throw new Error("noSuchField");

  const typed = opts.correctedTo?.trim();
  const corrected = typed !== undefined && typed !== "" && typed !== field.display;

  await db
    .update(extractionField)
    .set({
      status: corrected ? "corrected" : "confirmed",
      confirmedValue: corrected ? typed : field.value,
      confirmedBy: opts.actorId,
      confirmedAt: new Date(),
    })
    .where(eq(extractionField.id, opts.fieldId));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "extraction_field",
    entityId: opts.fieldId,
    action: corrected ? "correct" : "confirm",
    before: { read: field.display, confidence: Number(field.confidence) },
    after: { confirmed: corrected ? typed : field.value },
    reason: field.caveat,
    sourceScreen: "40",
  });

  return { corrected };
}

/**
 * Reject one field.
 *
 * Not a delete — the reading stays, marked rejected. What the machine got wrong
 * is the only record of what to fix, and a rejected field that vanishes teaches
 * nobody anything.
 */
export async function rejectField(fieldId: string, actorId: string) {
  await db
    .update(extractionField)
    .set({ status: "rejected", confirmedBy: actorId, confirmedAt: new Date() })
    .where(eq(extractionField.id, fieldId));

  await db.insert(auditEntry).values({
    actorId,
    actorKind: "user",
    entity: "extraction_field",
    entityId: fieldId,
    action: "reject",
    sourceScreen: "40",
  });
}

/**
 * Screen 40's "Confirm all high confidence".
 *
 * It confirms only what is above the threshold AND carries no caveat. A field
 * flagged "several candidates" is exactly the one a bulk button must not touch,
 * whatever its score — that is what the caveat is for.
 */
export async function confirmAllHighConfidence(dossierId: string, actorId: string) {
  const review = await loadReview(dossierId);
  if (!review) return { confirmed: 0 };

  const eligible = highConfidence(
    review.fields
      .filter((f) => f.status === "proposed")
      .map((f) => ({
        key: f.key,
        value: f.value,
        display: f.display,
        confidence: f.confidence,
        caveat: f.caveat,
        citation: f.citation,
      })),
    REVIEW_THRESHOLD,
  );

  const eligibleIds = review.fields
    .filter((f) => eligible.some((e) => e.key === f.key))
    .map((f) => f.id);

  for (const id of eligibleIds) {
    await confirmField({ fieldId: id, actorId });
  }

  return { confirmed: eligibleIds.length };
}
