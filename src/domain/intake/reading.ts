import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { intakeDossier } from "@/db/schema/dossier";
import { intakeAttachment } from "@/db/schema/intake";
import { storageFor } from "@/storage";
import { dossierKindOf, ingestDocument } from "./dossier";

/**
 * A tender dossier that arrives by email becomes a reviewable extraction on its
 * own — task 1.8.
 *
 * `ingestDocument` has accepted `messageId` and `attachmentId` since it was
 * written, and `intake_dossier` has carried both foreign keys, and nothing ever
 * passed them. So the only way a CCTP was ever read was for a person to
 * download it from Outlook and upload it again on screen 39 — which is the
 * shape of the whole complaint wave 1 exists to answer.
 *
 * This is the caller. It reports and does not decide: the worker turns an
 * outcome into a retry, and nothing here proposes a fact — LAW 2 holds all the
 * way through, and every field it produces is `proposed` until a person
 * confirms it against the source (screen 40, and 1.7 put the source on it).
 */

/**
 * What became of one attempt to read an attachment.
 *
 *   read          a dossier exists and is reviewable.
 *   already       one existed. A queue may deliver a job twice, and reading a
 *                 dossier twice would put two of it on screen 39.
 *   noBytes       the copy is not here — a reference attachment, or a fetch
 *                 that has not run. Not a failure and not this job's business.
 *   notReadable   an image, an archive, a .doc from 2003. Named rather than
 *                 counted, because "we cannot read that kind" is a fact worth
 *                 seeing on a dossier that came up short.
 *   gone          the row was dismissed while the job waited.
 *   failed        the file is not what its name said, or the store could not
 *                 be read. The dossier row records it as `failed` and screen 39
 *                 lists it as such — the file is not lost.
 */
export type ReadOutcome = {
  outcome: "read" | "already" | "noBytes" | "notReadable" | "gone" | "failed";
  dossierId?: string;
  fields?: number;
  reason?: string;
};

/** Read one attachment, by our own row id. */
export async function readAttachmentIntoDossier(attachmentId: string): Promise<ReadOutcome> {
  const [row] = await db
    .select({
      id: intakeAttachment.id,
      messageId: intakeAttachment.messageId,
      filename: intakeAttachment.filename,
      contentType: intakeAttachment.contentType,
      storagePath: intakeAttachment.storagePath,
    })
    .from(intakeAttachment)
    .where(eq(intakeAttachment.id, attachmentId))
    .limit(1);

  if (!row) return { outcome: "gone" };
  if (!row.storagePath) return { outcome: "noBytes" };

  // An archive is not read: it is EXPANDED, and each file that came out of it
  // is an attachment with a job of its own. Reading the zip itself would
  // produce a dossier of nothing.
  const kind = dossierKindOf(row.filename, row.contentType);
  if (!kind) return { outcome: "notReadable", reason: row.filename.split(".").pop() ?? "unknown" };

  const [existing] = await db
    .select({ id: intakeDossier.id })
    .from(intakeDossier)
    .where(eq(intakeDossier.attachmentId, row.id))
    .limit(1);
  if (existing) return { outcome: "already", dossierId: existing.id };

  let body: Buffer;
  try {
    body = await storageFor("working").get(row.storagePath);
  } catch (error) {
    // The row says the bytes are there and they are not. Worth one more try —
    // a store on a volume that has not mounted yet is the case — so it is a
    // failure rather than a state.
    return {
      outcome: "failed",
      reason: error instanceof Error ? error.message : "unreadableStore",
    };
  }

  try {
    const result = await ingestDocument({
      filename: row.filename,
      body,
      // The bytes are already in the working store. Keeping a second copy of
      // every dossier the company is ever sent, on a mini PC, buys nothing.
      storagePath: row.storagePath,
      mime: row.contentType,
      actorId: "system",
      messageId: row.messageId,
      attachmentId: row.id,
    });

    await db.insert(auditEntry).values({
      actorId: "system",
      actorKind: "system",
      entity: "intake_attachment",
      entityId: row.id,
      action: "read",
      after: {
        file: row.filename,
        dossier: result.dossierId,
        fields: result.fields,
        unreadPages: result.unreadPages,
      },
      sourceScreen: "39",
    });

    return { outcome: "read", dossierId: result.dossierId, fields: result.fields };
  } catch (error) {
    // `ingestDocument` has already marked its own row `failed` and written the
    // `unreadable` entry naming the file. Nothing to add here but the outcome.
    return { outcome: "failed", reason: error instanceof Error ? error.message : "unknown" };
  }
}
