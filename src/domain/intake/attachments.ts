import { asc, eq, isNull } from "drizzle-orm";
import {
  AttachmentHasNoBytes,
  fetchAttachmentBytes,
  fetchAttachments,
  type GraphAttachment,
  MailboxNotScoped,
  REFERENCE_ATTACHMENT,
} from "@/capture/mail/graph";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { intakeAttachment, intakeMessage } from "@/db/schema/intake";
import { type AttachmentFetchJob, attachmentFetchOptions, enqueue, QUEUES } from "@/jobs/queue";
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

/**
 * 1.10 — the attachments that predate the fetcher.
 *
 * `enqueue(QUEUES.attachmentFetch, …)` fires in exactly one place: `storeOne`,
 * as a message is stored. So only files discovered by a NEW sync are ever
 * queued, and every `intake_attachment` row written before 1.1–1.3 existed has
 * sat with a null `storage_path` since the day it arrived, with nothing that
 * would ever ask for it. On this database that is every row there is.
 *
 * THE GRAPH ID HAS TO BE RECOVERED FIRST, and that is why this is more than a
 * loop over `enqueue`. `external_id` arrived with 1.3 (migration 0055) because
 * a job running ten minutes after the poll has nothing else to ask Graph for —
 * so on a row written before it, the column is null, and `fetchAttachmentFor`
 * answers `gone / noGraphId` without spending a request. A backfill that only
 * queued would queue every one of them, store nothing, and look like it had
 * worked.
 *
 * So each message's attachments are listed once, live, and the rows are matched
 * against what the mailbox still holds. That listing is also the only place the
 * REFERENCE ATTACHMENT can be recognised: `intake_attachment` has no column for
 * `@odata.type`, so a stored row genuinely cannot say whether it is a OneDrive
 * link — and guessing from a null content type would be inventing a fact about
 * somebody's mail. Graph is asked instead.
 *
 * Read-only against the mailbox, and re-runnable: the singleton key is the row
 * id, so a second run while the first is still draining cannot queue anything
 * twice.
 */

/** A row waiting for bytes, and the little it knows about itself. */
export type PendingAttachment = {
  id: string;
  filename: string;
  sizeBytes: number | null;
  externalId: string | null;
};

/**
 * Which listing entry belongs to which row.
 *
 * Three passes, narrowing, and an entry is claimed by at most one row. A row
 * that stays unmatched is REPORTED rather than guessed at — the alternative is
 * writing one file's Graph id onto another file's row, which would put the
 * wrong bytes behind a name on screen 40 and be invisible until somebody read
 * the document.
 *
 *   1. the id we already hold, for rows captured since 1.3. Survives a rename.
 *   2. name AND size. `size_bytes` on an unfetched row is still Graph's own
 *      figure — 1.2 overwrites it with the length of the copy only once the
 *      bytes are here, and these rows have no bytes — so the two are
 *      comparable.
 *   3. name alone, for the case where Graph reports the size differently than
 *      it did at capture. Only when exactly one entry is left with that name.
 */
export function matchToListing(
  rows: PendingAttachment[],
  listing: GraphAttachment[],
): Map<string, GraphAttachment> {
  const matched = new Map<string, GraphAttachment>();
  const claimed = new Set<string>();

  const take = (row: PendingAttachment, candidates: GraphAttachment[]): void => {
    const free = candidates.filter((candidate) => !claimed.has(candidate.id));
    // Two candidates is not a match, it is a coin toss. Leave it unmatched.
    if (free.length !== 1) return;
    const only = free[0];
    if (!only) return;
    matched.set(row.id, only);
    claimed.add(only.id);
  };

  for (const row of rows) {
    if (!row.externalId) continue;
    take(
      row,
      listing.filter((entry) => entry.id === row.externalId),
    );
  }
  for (const row of rows) {
    if (matched.has(row.id)) continue;
    take(
      row,
      listing.filter((entry) => entry.name === row.filename && entry.size === row.sizeBytes),
    );
  }
  for (const row of rows) {
    if (matched.has(row.id)) continue;
    take(
      row,
      listing.filter((entry) => entry.name === row.filename),
    );
  }

  return matched;
}

/**
 * What the backfill did with one row.
 *
 *   queued        a fetch job is on the queue. The worker does the rest.
 *   deduplicated  pg-boss already had one under the same key. Not a failure —
 *                 it is what makes running this twice safe.
 *   reference     a link to OneDrive or SharePoint. Nothing to fetch, and the
 *                 null path is the correct answer forever.
 *   notInMailbox  the message no longer lists a file this row could be. The
 *                 row is not touched and nothing is queued.
 *   noMessageId   the message row has no Graph id, so nothing can be asked.
 *   unreachable   Graph refused the listing — the scope, or the network.
 */
export type BackfillOutcome =
  | "queued"
  | "deduplicated"
  | "reference"
  | "notInMailbox"
  | "noMessageId"
  | "unreachable";

export type BackfillRow = {
  attachmentId: string;
  filename: string;
  outcome: BackfillOutcome;
  reason?: string;
  /** True when this run wrote the Graph id the row had been missing. */
  idRecovered?: boolean;
};

export type BackfillReport = {
  dryRun: boolean;
  /** Messages whose listing was asked for. */
  messages: number;
  rows: BackfillRow[];
  counts: Record<BackfillOutcome, number>;
  /**
   * How many listing entries carried `@odata.type` at all. It is an annotation
   * and `$select` does not name it, so it may simply be absent — in which case
   * a reference cannot be recognised here and Graph's 405 is what catches it,
   * one wasted request per link. Counted rather than assumed.
   */
  typed: number;
  untyped: number;
};

const NO_OUTCOMES: Record<BackfillOutcome, number> = {
  queued: 0,
  deduplicated: 0,
  reference: 0,
  notInMailbox: 0,
  noMessageId: 0,
  unreachable: 0,
};

/**
 * Queue a fetch for everything still without bytes.
 *
 * Reports; does not print. `scripts/backfill-attachments.ts` is what a person
 * runs, and what says any of this out loud.
 */
export async function backfillAttachmentFetches(
  options: { dryRun?: boolean } = {},
): Promise<BackfillReport> {
  const dryRun = options.dryRun ?? false;

  const pending = await db
    .select({
      id: intakeAttachment.id,
      filename: intakeAttachment.filename,
      sizeBytes: intakeAttachment.sizeBytes,
      externalId: intakeAttachment.externalId,
      messageExternalId: intakeMessage.externalId,
    })
    .from(intakeAttachment)
    .innerJoin(intakeMessage, eq(intakeAttachment.messageId, intakeMessage.id))
    .where(isNull(intakeAttachment.storagePath))
    .orderBy(asc(intakeMessage.receivedAt));

  // One listing per message, not one per file: a seven-file dossier is one
  // request, and the mailbox is somebody else's server on a link that drops.
  const byMessage = new Map<string, PendingAttachment[]>();
  const orphans: PendingAttachment[] = [];

  for (const row of pending) {
    const entry = {
      id: row.id,
      filename: row.filename,
      sizeBytes: row.sizeBytes,
      externalId: row.externalId,
    };
    if (!row.messageExternalId) {
      orphans.push(entry);
      continue;
    }
    const group = byMessage.get(row.messageExternalId);
    if (group) group.push(entry);
    else byMessage.set(row.messageExternalId, [entry]);
  }

  const rows: BackfillRow[] = [];
  let typed = 0;
  let untyped = 0;

  for (const row of orphans) {
    rows.push({
      attachmentId: row.id,
      filename: row.filename,
      outcome: "noMessageId",
      reason: "the message carries no Graph id, so the mailbox cannot be asked for this file",
    });
  }

  for (const [messageExternalId, group] of byMessage) {
    let listing: GraphAttachment[];
    try {
      listing = await fetchAttachments(messageExternalId);
    } catch (error) {
      const reason =
        error instanceof MailboxNotScoped
          ? error.detail
          : error instanceof Error
            ? error.message
            : "unknown";
      for (const row of group) {
        rows.push({ attachmentId: row.id, filename: row.filename, outcome: "unreachable", reason });
      }
      continue;
    }

    for (const entry of listing) {
      if (entry["@odata.type"]) typed++;
      else untyped++;
    }

    const matched = matchToListing(group, listing);

    for (const row of group) {
      const entry = matched.get(row.id);

      if (!entry) {
        rows.push({
          attachmentId: row.id,
          filename: row.filename,
          outcome: "notInMailbox",
          reason: "the message lists no file this row could be",
        });
        continue;
      }

      if (entry["@odata.type"] === REFERENCE_ATTACHMENT) {
        rows.push({
          attachmentId: row.id,
          filename: row.filename,
          outcome: "reference",
          reason: "a link to a file in the cloud, not a file in the message",
        });
        continue;
      }

      const idRecovered = row.externalId !== entry.id;

      if (idRecovered && !dryRun) {
        await db
          .update(intakeAttachment)
          .set({ externalId: entry.id })
          .where(eq(intakeAttachment.id, row.id));

        // The trail says where the id came from. A column that filled itself
        // between two readings of screen 32 is a column nobody trusts.
        await db.insert(auditEntry).values({
          actorId: "system",
          actorKind: "system",
          entity: "intake_attachment",
          entityId: row.id,
          action: "backfill",
          before: { externalId: row.externalId },
          after: { externalId: entry.id, file: row.filename },
          sourceScreen: "38",
        });
      }

      const job = dryRun
        ? "dry-run"
        : await enqueue(
            QUEUES.attachmentFetch,
            { attachmentId: row.id } satisfies AttachmentFetchJob,
            attachmentFetchOptions(row.id),
          );

      rows.push({
        attachmentId: row.id,
        filename: row.filename,
        outcome: job === null ? "deduplicated" : "queued",
        idRecovered,
      });
    }
  }

  const counts = { ...NO_OUTCOMES };
  for (const row of rows) counts[row.outcome]++;

  return { dryRun, messages: byMessage.size, rows, counts, typed, untyped };
}
