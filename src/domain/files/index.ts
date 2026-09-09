import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { intakeDossier } from "@/db/schema/dossier";
import { importBatch } from "@/db/schema/import";
import { intakeAttachment, intakeMessage } from "@/db/schema/intake";
import { item, itemMedia } from "@/db/schema/item";

/**
 * Screen 60 — Files.
 *
 * There is no `file` table, and there is not going to be one.
 *
 * Every file the system holds is already recorded by whatever brought it in:
 * an email attachment belongs to a message, a read dossier belongs to itself,
 * a spreadsheet belongs to the import that consumed it, an item's datasheet
 * belongs to the item. A fifth table duplicating those four would be a table
 * that can disagree with them — the same argument `src/storage/local.ts` makes
 * about the disk, one level up.
 *
 * So this file is a VIEW. It reads the four tables that own files and unions
 * them. LAW 1: compute, do not store.
 */

/** Which table the row came from. The id is prefixed with it, so ids are unique. */
export const FILE_KINDS = ["attachment", "dossier", "import", "item"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/**
 * Where the bytes are.
 *
 * `absent` is the state that matters. An email attachment whose `storage_path`
 * is null was never fetched — the file is in Outlook and nowhere else, and the
 * message screen already says so. Calling that "missing" would be a lie about a
 * file that is perfectly safe; calling it "stored" would be a worse one.
 */
export type BytesState = "stored" | "absent";

export type FileRow = {
  id: string;
  kind: FileKind;
  filename: string;
  contentType: string | null;
  bytes: number | null;
  storagePath: string | null;
  state: BytesState;
  at: Date;
  /**
   * What it arrived with.
   *
   * `label` is free text a person wrote — an email subject. `labelKey` is a
   * message key, for the rows whose only description is an enumerated column:
   * a dossier's `status`, an import's `becomes`. Printing those raw put
   * "failed" and "party" in a French table, which is the system leaking its own
   * schema at somebody. `href` is null when the owner has no screen yet.
   */
  belongsTo: {
    fallbackKey: string;
    label: string | null;
    labelKey: string | null;
    href: string | null;
  };
};

/** `attachment:9f0c…` — carried in URLs, so it must not contain a slash. */
export function fileId(kind: FileKind, id: string): string {
  return `${kind}:${id}`;
}

export function parseFileId(value: string): { kind: FileKind; id: string } | null {
  const at = value.indexOf(":");
  if (at < 1) return null;
  const kind = value.slice(0, at);
  const id = value.slice(at + 1);
  if (!FILE_KINDS.includes(kind as FileKind) || !id) return null;
  return { kind: kind as FileKind, id };
}

/**
 * A path that is present but empty is not a path.
 *
 * `createDossier` inserts `storage_path: ""` and fills it in once the bytes
 * land, so an empty string means what null means and has to be treated the same
 * way — otherwise a dossier that failed mid-upload shows as stored.
 */
function pathOrNull(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function attachmentFiles(): Promise<FileRow[]> {
  const rows = await db
    .select({
      id: intakeAttachment.id,
      filename: intakeAttachment.filename,
      contentType: intakeAttachment.contentType,
      bytes: intakeAttachment.sizeBytes,
      storagePath: intakeAttachment.storagePath,
      at: intakeAttachment.createdAt,
      messageId: intakeMessage.id,
      subject: intakeMessage.subject,
      fromName: intakeMessage.fromName,
      fromAddress: intakeMessage.fromAddress,
    })
    .from(intakeAttachment)
    .innerJoin(intakeMessage, eq(intakeAttachment.messageId, intakeMessage.id))
    .orderBy(desc(intakeAttachment.createdAt));

  return rows.map((r) => {
    const storagePath = pathOrNull(r.storagePath);
    return {
      id: fileId("attachment", r.id),
      kind: "attachment" as const,
      filename: r.filename,
      contentType: r.contentType,
      bytes: r.bytes,
      storagePath,
      state: (storagePath ? "stored" : "absent") as BytesState,
      at: r.at,
      belongsTo: {
        fallbackKey: "message",
        label: r.subject?.trim() || r.fromName?.trim() || r.fromAddress?.trim() || null,
        labelKey: null,
        href: `/inbox/${r.messageId}`,
      },
    };
  });
}

async function dossierFiles(): Promise<FileRow[]> {
  const rows = await db
    .select({
      id: intakeDossier.id,
      filename: intakeDossier.filename,
      storagePath: intakeDossier.storagePath,
      status: intakeDossier.status,
      at: intakeDossier.createdAt,
    })
    .from(intakeDossier)
    .orderBy(desc(intakeDossier.createdAt));

  return rows.map((r) => {
    const storagePath = pathOrNull(r.storagePath);
    return {
      id: fileId("dossier", r.id),
      kind: "dossier" as const,
      filename: r.filename,
      /*
        `ingestPdf` is the only writer and it puts the bytes with
        `mime: "application/pdf"`. Repeating that claim here is not sniffing —
        it is reading back what the writer declared — and it is what lets the
        serving route send a dossier inline instead of as a download.

        Except when the read FAILED. Those rows keep their bytes on purpose, and
        the reason a dossier fails is usually that the file was not the PDF
        somebody thought it was. Claiming a type for it would be asserting the
        very thing the row records not being true.
      */
      contentType: r.status === "failed" ? null : "application/pdf",
      // The dossier row records pages, not bytes. Printing "0 B" would be a
      // measurement that was never taken; printing nothing is the truth.
      bytes: null,
      storagePath,
      state: (storagePath ? "stored" : "absent") as BytesState,
      at: r.at,
      belongsTo: {
        fallbackKey: "dossier",
        label: null,
        labelKey: `files.dossierStatus.${r.status}`,
        href: `/inbox/dossier/${r.id}/review`,
      },
    };
  });
}

async function importFiles(): Promise<FileRow[]> {
  const rows = await db
    .select({
      id: importBatch.id,
      filename: importBatch.filename,
      becomes: importBatch.becomes,
      at: importBatch.createdAt,
    })
    .from(importBatch)
    .orderBy(desc(importBatch.createdAt));

  return rows.map((r) => ({
    id: fileId("import", r.id),
    kind: "import" as const,
    filename: r.filename,
    contentType: null,
    bytes: null,
    // `import_batch` has no storage_path column: the path is derived from the
    // batch id and the filename, which is what `storagePathFor` is for.
    // Recomputing it here would put that rule in two places, so the row carries
    // the batch id and the serving route asks the import module for the bytes.
    storagePath: null,
    state: "stored" as BytesState,
    at: r.at,
    belongsTo: {
      fallbackKey: "import",
      label: null,
      labelKey: `files.importBecomes.${r.becomes}`,
      href: "/settings/import",
    },
  }));
}

/**
 * An item's technical file — the datasheet a tender asked for.
 *
 * The row owns its bytes, so unlike an attachment there is no "absent" state:
 * the path is `not null` because the row is written after the upload landed.
 */
async function itemFiles(): Promise<FileRow[]> {
  const rows = await db
    .select({
      id: itemMedia.id,
      filename: itemMedia.filename,
      contentType: itemMedia.contentType,
      bytes: itemMedia.sizeBytes,
      storagePath: itemMedia.storagePath,
      at: itemMedia.createdAt,
      itemId: itemMedia.itemId,
      code: item.code,
      designation: item.designation,
    })
    .from(itemMedia)
    .innerJoin(item, eq(item.id, itemMedia.itemId))
    .orderBy(desc(itemMedia.createdAt));

  return rows.map((r) => ({
    id: fileId("item", r.id),
    kind: "item" as const,
    filename: r.filename,
    contentType: r.contentType,
    bytes: r.bytes,
    storagePath: pathOrNull(r.storagePath),
    state: "stored" as BytesState,
    at: r.at,
    belongsTo: {
      fallbackKey: "item",
      label: `${r.code} · ${r.designation}`,
      labelKey: null,
      href: `/items/${r.itemId}/technical`,
    },
  }));
}

export async function listFiles(kind?: FileKind): Promise<FileRow[]> {
  const parts = await Promise.all([
    !kind || kind === "attachment" ? attachmentFiles() : Promise.resolve([]),
    !kind || kind === "dossier" ? dossierFiles() : Promise.resolve([]),
    !kind || kind === "import" ? importFiles() : Promise.resolve([]),
    !kind || kind === "item" ? itemFiles() : Promise.resolve([]),
  ]);

  return parts.flat().sort((a, b) => b.at.getTime() - a.at.getTime());
}

export type FileCounts = Record<FileKind | "all" | "absent", number>;

export async function fileCounts(): Promise<FileCounts> {
  const all = await listFiles();
  return {
    all: all.length,
    attachment: all.filter((f) => f.kind === "attachment").length,
    dossier: all.filter((f) => f.kind === "dossier").length,
    import: all.filter((f) => f.kind === "import").length,
    item: all.filter((f) => f.kind === "item").length,
    absent: all.filter((f) => f.state === "absent").length,
  };
}

export async function fileByIndexId(value: string): Promise<FileRow | null> {
  const parsed = parseFileId(value);
  if (!parsed) return null;
  const rows = await listFiles(parsed.kind);
  return rows.find((f) => f.id === value) ?? null;
}
