import { eq } from "drizzle-orm";
import { AttachmentHasNoBytes, fetchAttachmentBytes, MailboxNotScoped } from "@/capture/mail/graph";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { intakeAttachment, intakeMessage } from "@/db/schema/intake";
import { storageFor } from "@/storage";
import { sha256 } from "@/storage/local";

/**
 * Taking one attachment out of the mailbox and putting it where the ERP can
 * serve it.
 *
 * This is the slow, network-dependent half of capture, and it lives apart from
 * the poll because it is retried on its own. A dossier is a dozen files; the
 * link dropping on file nine must cost file nine, not the message, not the
 * other eleven, and not the poll.
 */

/**
 * Where an attachment's bytes go. Same shape as `storagePathFor` in
 * `dossier.ts` and in `import/batch.ts`: a folder named after the row that owns
 * the file, and a filename with anything structural taken out of it.
 *
 * Keyed on OUR row id, not on the Graph attachment id. Graph ids are long,
 * base64-ish and change when a message is moved between folders; a path built
 * from one would stop resolving for a reason nobody could see on screen.
 */
export function storagePathFor(attachmentId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return `attachments/${attachmentId}/${safe}`;
}

/**
 * What became of one attempt.
 *
 *   stored   the bytes are on disk and the row points at them.
 *   already  they were already there. A queue may deliver a job twice, and
 *            fetching a 12 MB file again to write the same bytes is not free.
 *   linked   the attachment is a reference — a OneDrive or SharePoint link.
 *            There is nothing in the mailbox to fetch, the null path is
 *            correct, and retrying it is retrying a fact.
 *   gone     the row, or the message it belonged to, is no longer there.
 *   failed   the network, or Graph, on a bad day. This one is worth retrying,
 *            and it is the ONLY one that is.
 */
export type FetchOutcome = {
  outcome: "stored" | "already" | "linked" | "gone" | "failed";
  reason?: string;
};

/**
 * Fetch one attachment by our own row id.
 *
 * It reports; it does not decide. The job wrapper in `src/jobs/` is what turns
 * `failed` into a retry, because whether to try again is a queue's business and
 * not a domain function's.
 */
export async function fetchAttachmentFor(attachmentId: string): Promise<FetchOutcome> {
  const [row] = await db
    .select({
      id: intakeAttachment.id,
      filename: intakeAttachment.filename,
      externalId: intakeAttachment.externalId,
      storagePath: intakeAttachment.storagePath,
      messageExternalId: intakeMessage.externalId,
    })
    .from(intakeAttachment)
    .innerJoin(intakeMessage, eq(intakeAttachment.messageId, intakeMessage.id))
    .where(eq(intakeAttachment.id, attachmentId))
    .limit(1);

  // The message was dismissed and cascaded away while the job sat in the queue.
  // Not a failure, and emphatically not something to retry.
  if (!row) return { outcome: "gone" };
  if (row.storagePath) return { outcome: "already" };
  if (!row.externalId || !row.messageExternalId) {
    // Captured before this column existed. The original is still in the
    // mailbox; there is simply no way to ask Graph for it by name.
    return { outcome: "gone", reason: "noGraphId" };
  }

  const result = await store(row.id, row.messageExternalId, row.externalId, row.filename);

  await db.insert(auditEntry).values({
    actorId: "system",
    actorKind: "system",
    entity: "intake_attachment",
    entityId: row.id,
    action: "fetch",
    after: { file: row.filename, ...result },
    sourceScreen: "38",
  });

  return result;
}

async function store(
  rowId: string,
  graphMessageId: string,
  graphAttachmentId: string,
  filename: string,
): Promise<FetchOutcome> {
  try {
    const got = await fetchAttachmentBytes(graphMessageId, graphAttachmentId);
    const path = storagePathFor(rowId, filename);

    await storageFor("working").put({ path, body: got.bytes, mime: got.contentType });

    await db
      .update(intakeAttachment)
      .set({
        storagePath: path,
        sha256: sha256(got.bytes),
        // Graph's `size` is the attachment as it sits in the mail store, which
        // includes its encoding overhead. Now that the bytes are here, the row
        // can say what screen 60 will actually hand over.
        sizeBytes: got.bytes.byteLength,
      })
      .where(eq(intakeAttachment.id, rowId));

    return { outcome: "stored" };
  } catch (error) {
    if (error instanceof AttachmentHasNoBytes) {
      return { outcome: "linked", reason: error.detail };
    }
    // A 403 here, after the listing succeeded, is the Exchange permission cache
    // catching up — a state that clears itself, which is precisely a thing to
    // try again rather than a thing to give up on.
    return {
      outcome: "failed",
      reason:
        error instanceof MailboxNotScoped
          ? error.detail
          : error instanceof Error
            ? error.message
            : "unknown",
    };
  }
}
