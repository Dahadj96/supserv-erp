import { eq } from "drizzle-orm";
import { ArchiveRefused, looksLikeArchive, readZip, type ZipRefusal } from "@/capture/archive/zip";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { intakeAttachment } from "@/db/schema/intake";
import { storageFor } from "@/storage";
import { sha256 } from "@/storage/local";
import { storagePathFor } from "./attachments";
import { attachmentLooksLike } from "./mailbox";

/**
 * A `dossier.zip` becoming files a person can read.
 *
 * An appel d'offres usually arrives as one archive: the CCTP, the bordereau des
 * prix, the règlement de la consultation and half a dozen annexes. Before this,
 * the ERP showed one paperclip called `dossier.zip` and the only way to read
 * any of it was Outlook and File Explorer — the exact thing wave 1 exists to
 * end.
 *
 * THE ARCHIVE IS NEVER TOUCHED. Its row keeps its bytes, its name and its
 * place; the files inside it become rows BESIDE it, each pointing back at it.
 * A tender dossier is evidence (CLAUDE.md), and the copy of it that was
 * actually sent is the archive, not our unpacking of it.
 *
 * All the hostility is handled one layer down, in `src/capture/archive/zip.ts`.
 * This file writes rows.
 */

/**
 * What one attempt at expanding an archive came to.
 *
 *   expanded     rows were written for the files inside.
 *   already      it has children; a queue may deliver the same job twice.
 *   notArchive   the attachment is not an archive. Not a fault, just the
 *                answer for the other 37 of 38 files in this mailbox.
 *   noBytes      the copy is not here yet, or never will be (a OneDrive link).
 *   nested       this row is itself INSIDE an archive. One level, on purpose.
 *   refused      the archive was opened and must not be unpacked. This is the
 *                zip bomb, the corrupt file and the one that is not a zip —
 *                terminal every time, which is why nothing retries it.
 */
export type ExpandOutcome = {
  outcome: "expanded" | "already" | "notArchive" | "noBytes" | "nested" | "refused";
  /** Files written as rows. */
  files?: number;
  /** Entries inside the archive that were skipped, each with its reason. */
  refused?: ZipRefusal[];
  reason?: string;
};

/**
 * The content type an unpacked file gets.
 *
 * Nobody declared one. An attachment's content type is the sender's word —
 * `serving.ts` says so at length, and that is why nothing anywhere else in this
 * repository upgrades a declared type from an extension. Inside a zip there is
 * no declared type at all: the archive format simply has no field for it. So
 * this is not overriding a claim, it is the only source there is.
 *
 * It maps into a SUBSET of `RENDERABLE`, and deliberately not the whole of it:
 * `text/plain` is absent, and `text/html` and `image/svg+xml` are not here and
 * must never be, because a file the ERP will render in place, from our own
 * origin, in the Gérant's session, is the door that set exists to hold shut.
 * Anything unrecognised gets null and is a download — the honest answer, and
 * the same one an email attachment with no declared type gets today.
 */
const TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export function typeForEntry(path: string): string | null {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return TYPE_BY_EXTENSION[extension] ?? null;
}

/**
 * Expand one attachment, if it is an archive.
 *
 * Reports; never throws. It runs after the bytes are stored, inside the same
 * job, and an archive that cannot be unpacked must not cost the message it
 * arrived on, nor make the queue fetch 12 MB again to fail the same way — every
 * refusal here is terminal by nature, so the caller records it and stops.
 */
export async function expandArchiveFor(attachmentId: string): Promise<ExpandOutcome> {
  const [row] = await db
    .select({
      id: intakeAttachment.id,
      messageId: intakeAttachment.messageId,
      filename: intakeAttachment.filename,
      contentType: intakeAttachment.contentType,
      storagePath: intakeAttachment.storagePath,
      parentAttachmentId: intakeAttachment.parentAttachmentId,
    })
    .from(intakeAttachment)
    .where(eq(intakeAttachment.id, attachmentId))
    .limit(1);

  if (!row) return { outcome: "noBytes", reason: "gone" };
  if (row.parentAttachmentId) return { outcome: "nested" };
  if (!looksLikeArchive(row.filename, row.contentType)) return { outcome: "notArchive" };
  if (!row.storagePath) return { outcome: "noBytes" };

  const [child] = await db
    .select({ id: intakeAttachment.id })
    .from(intakeAttachment)
    .where(eq(intakeAttachment.parentAttachmentId, row.id))
    .limit(1);
  if (child) return { outcome: "already" };

  const store = storageFor("working");

  let reading: Awaited<ReturnType<typeof readZip>>;
  try {
    reading = await readZip(await store.get(row.storagePath));
  } catch (error) {
    const reason = error instanceof ArchiveRefused ? error.detail : "unreadable";
    await log(row.id, { outcome: "refused", reason });
    return { outcome: "refused", reason };
  }

  let files = 0;

  for (const entry of reading.entries) {
    // The row first, then the bytes: the storage path is keyed on the row's own
    // id, the same way `storeOne` does it, so there is never a path built from
    // something that can change.
    const [created] = await db
      .insert(intakeAttachment)
      .values({
        messageId: row.messageId,
        parentAttachmentId: row.id,
        // The path inside the archive, kept whole. `annexes/bordereau.pdf` says
        // more than `bordereau.pdf` does, and on a dossier that structure is
        // most of what the sender meant.
        filename: entry.path,
        contentType: typeForEntry(entry.path),
        sizeBytes: entry.bytes.byteLength,
        // Nothing in the mailbox corresponds to this file: it was inside
        // another one. A null `external_id` is the truthful answer, and it is
        // what keeps the backfill and the fetcher from ever asking Graph for it.
        externalId: null,
        looksLike: attachmentLooksLike(entry.path),
      })
      .returning({ id: intakeAttachment.id });

    const childId = created?.id;
    if (!childId) continue;

    const path = storagePathFor(childId, entry.path);
    await store.put({
      path,
      body: entry.bytes,
      mime: typeForEntry(entry.path) ?? "application/octet-stream",
    });

    await db
      .update(intakeAttachment)
      .set({ storagePath: path, sha256: sha256(entry.bytes) })
      .where(eq(intakeAttachment.id, childId));

    files++;
  }

  const result: ExpandOutcome = {
    outcome: "expanded",
    files,
    ...(reading.refused.length > 0 ? { refused: reading.refused } : {}),
  };

  await log(row.id, result);
  return result;
}

/**
 * One audit entry per archive, carrying what came out and what was turned away.
 *
 * A refusal that is not written down is a file that silently is not there, and
 * screen 32 is where somebody finds out why an annexe they were told about is
 * missing. Nothing in this layer prints — the worker is the only thing that
 * talks to a console.
 */
async function log(attachmentId: string, result: ExpandOutcome): Promise<void> {
  await db.insert(auditEntry).values({
    actorId: "system",
    actorKind: "system",
    entity: "intake_attachment",
    entityId: attachmentId,
    action: "expand",
    after: { ...result },
    sourceScreen: "40",
  });
}
