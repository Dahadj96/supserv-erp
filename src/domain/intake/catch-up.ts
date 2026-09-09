import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { looksLikeArchive } from "@/capture/archive/zip";
import { db } from "@/db";
import { intakeDossier } from "@/db/schema/dossier";
import { intakeAttachment } from "@/db/schema/intake";
import { type DossierReadJob, dossierReadOptions, enqueue, QUEUES } from "@/jobs/queue";
import { expandArchiveFor } from "./archive";
import { type BackfillReport, backfillAttachmentFetches } from "./attachments";
import { dossierKindOf } from "./dossier";

/**
 * 1.11 — what is already stored catches up with what wave 1 learned to do.
 *
 * EVERY CAPABILITY IN WAVE 1 RUNS ON ARRIVAL. The fetcher fires as a message is
 * stored, expansion fires after a fetch, reading fires after an expansion —
 * each of them hangs off the one before, and the whole chain hangs off a file
 * being NEW. Nothing in it ever looks at a row that was already there, and in
 * one night that cost three separate catch-ups: 1.10 for the bytes, a throwaway
 * for the single archive whose bytes 1.10 itself had just delivered (so no
 * fetch would ever run for it again, so it was never opened), and nothing at
 * all for the text 1.6 and 1.8 extract.
 *
 * This is the one catch-up, and the order is the whole of it:
 *
 *   1. bytes       — 1.10, unchanged. Queues a fetch for every row without one.
 *   2. archives    — `expandArchiveFor` over every stored top-level attachment.
 *   3. text        — a `dossier.read` job for every stored attachment that has
 *                    no dossier, INCLUDING the children stage 2 just wrote.
 *                    Those rows do not exist until stage 2 has run, which is
 *                    why this is an order and not a list.
 *
 * IT REUSES THE WORKER'S PATHS RATHER THAN REPEATING THEM. Stage 2 calls the
 * same `expandArchiveFor` the worker calls; stage 3 puts the same job on the
 * same queue with the same options, so a file caught up here is read by exactly
 * the code that reads a file that arrived normally. A second reading path would
 * be a second thing to keep true.
 *
 * EVERY STAGE IS A NO-OP ON WHAT IS ALREADY DONE. Stage 1 selects only rows
 * with a null `storage_path`; stage 2 leans on `expandArchiveFor`'s own guards
 * (`notArchive`, `nested`, `already`, `noBytes` are all no-ops, which is why it
 * can be looped over everything); stage 3 skips an attachment a dossier already
 * points at, and the queue's singleton key catches the rest. So this can be run
 * as often as anybody likes, and running it after a normal sync does nothing.
 *
 * WHAT ONE RUN CANNOT DO. Stage 1 queues; it does not fetch — `pnpm worker` is
 * what empties the queue, and bytes that arrive after this run are expanded and
 * read by the worker itself, on the normal path. So a database with unfetched
 * attachments converges over two runs, and the second one is honest about it.
 */

/**
 * What one stored attachment came to in the archive stage.
 *
 * The first six are `expandArchiveFor`'s own outcomes, kept by name so the
 * report says what the function said. `wouldExpand` is the dry run's answer,
 * and `failed` is the write itself going wrong — which the function does not
 * do, and which must still not stop the other rows.
 */
export type ArchiveOutcome =
  | "expanded"
  | "wouldExpand"
  | "already"
  | "notArchive"
  | "noBytes"
  | "nested"
  | "refused"
  | "failed";

export type ArchiveCatchUpRow = {
  attachmentId: string;
  filename: string;
  outcome: ArchiveOutcome;
  /** Rows written for the files inside. */
  files?: number;
  /** Entries the reader turned away — a traversing name, a nested zip, a cap. */
  refused?: number;
  reason?: string;
};

export type ArchiveStage = {
  /** Stored top-level attachments looked at. */
  considered: number;
  counts: Record<ArchiveOutcome, number>;
  /**
   * Only the rows that are archives.
   *
   * 37 of the 38 files in this mailbox are not archives and a report that names
   * each of them is a report nobody reads — the same reason `expandArchiveFor`
   * writes no audit entry for one. They are counted, not listed.
   */
  rows: ArchiveCatchUpRow[];
};

/**
 * What one stored attachment came to in the text stage.
 *
 *   queued        a reading is on the queue. The worker does the rest.
 *   wouldQueue    the dry run's answer.
 *   deduplicated  pg-boss already had one under the same key.
 *   already       a dossier points at it. Including a failed one — that is
 *                 what `readAttachmentIntoDossier` answers too, and a re-read
 *                 has no route (Known gaps, 1.8).
 *   notReadable   an image, an archive, a .doc from 2003, a .pptx. Named and
 *                 counted rather than silently absent, because "we cannot read
 *                 that kind" is the answer to "why is there no text".
 *   failed        the job could not be put on the queue.
 */
export type TextOutcome =
  | "queued"
  | "wouldQueue"
  | "deduplicated"
  | "already"
  | "notReadable"
  | "failed";

export type TextCatchUpRow = {
  attachmentId: string;
  filename: string;
  outcome: TextOutcome;
  reason?: string;
};

export type TextStage = {
  /** Stored attachments looked at, children included. */
  considered: number;
  counts: Record<TextOutcome, number>;
  rows: TextCatchUpRow[];
};

export type BytesStage = {
  /** Rows that already had their bytes before this ran. */
  alreadyStored: number;
  report: BackfillReport;
};

export type CatchUpReport = {
  dryRun: boolean;
  bytes: BytesStage;
  archives: ArchiveStage;
  text: TextStage;
};

const NO_ARCHIVE_OUTCOMES: Record<ArchiveOutcome, number> = {
  expanded: 0,
  wouldExpand: 0,
  already: 0,
  notArchive: 0,
  noBytes: 0,
  nested: 0,
  refused: 0,
  failed: 0,
};

const NO_TEXT_OUTCOMES: Record<TextOutcome, number> = {
  queued: 0,
  wouldQueue: 0,
  deduplicated: 0,
  already: 0,
  notReadable: 0,
  failed: 0,
};

/**
 * Stage 1 — the bytes. 1.10, with the count of what was already there.
 *
 * `backfillAttachmentFetches` reports on the rows WITHOUT bytes, which is all it
 * touches and all it should touch. "How many were already done" is the other
 * half of the same question and is one count, asked here rather than widening
 * the thing that does the work.
 */
export async function catchUpBytes(options: { dryRun?: boolean } = {}): Promise<BytesStage> {
  const stored = await db
    .select({ id: intakeAttachment.id })
    .from(intakeAttachment)
    .where(isNotNull(intakeAttachment.storagePath));

  return {
    alreadyStored: stored.length,
    report: await backfillAttachmentFetches({ dryRun: options.dryRun ?? false }),
  };
}

/**
 * Stage 2 — open the archives whose bytes are already here.
 *
 * Every stored top-level attachment is offered to `expandArchiveFor`, which
 * refuses all the ones that are not archives itself. That is deliberate: the
 * alternative is a second copy of "is this an archive" in this file, and the
 * day the two disagree is the day a dossier stops being unpacked for a reason
 * nobody can see. `looksLikeArchive` IS used here, but only by the dry run —
 * which cannot call the real thing, because the real thing writes.
 *
 * A child is never offered: a row with a parent is one level down and
 * `expandArchiveFor` answers `nested`. Filtering here as well saves the query
 * a round trip per file and says the rule out loud in the place a reader is.
 */
export async function catchUpArchives(options: { dryRun?: boolean } = {}): Promise<ArchiveStage> {
  const dryRun = options.dryRun ?? false;

  const stored = await db
    .select({
      id: intakeAttachment.id,
      filename: intakeAttachment.filename,
      contentType: intakeAttachment.contentType,
    })
    .from(intakeAttachment)
    .where(
      and(isNotNull(intakeAttachment.storagePath), isNull(intakeAttachment.parentAttachmentId)),
    )
    .orderBy(intakeAttachment.filename);

  const counts = { ...NO_ARCHIVE_OUTCOMES };
  const rows: ArchiveCatchUpRow[] = [];

  for (const row of stored) {
    let entry: ArchiveCatchUpRow;

    if (dryRun) {
      if (!looksLikeArchive(row.filename, row.contentType)) {
        entry = { attachmentId: row.id, filename: row.filename, outcome: "notArchive" };
      } else {
        // Whether it HAS children is the same question `expandArchiveFor` asks
        // before it writes anything, and the only one that can be asked without
        // opening the file.
        const [child] = await db
          .select({ id: intakeAttachment.id })
          .from(intakeAttachment)
          .where(eq(intakeAttachment.parentAttachmentId, row.id))
          .limit(1);
        entry = {
          attachmentId: row.id,
          filename: row.filename,
          outcome: child ? "already" : "wouldExpand",
        };
      }
    } else {
      try {
        const result = await expandArchiveFor(row.id);
        entry = {
          attachmentId: row.id,
          filename: row.filename,
          outcome: result.outcome,
          ...(result.files !== undefined ? { files: result.files } : {}),
          ...(result.refused?.length ? { refused: result.refused.length } : {}),
          ...(result.reason ? { reason: result.reason } : {}),
        };
      } catch (error) {
        entry = {
          attachmentId: row.id,
          filename: row.filename,
          outcome: "failed",
          reason: error instanceof Error ? error.message : "unknown",
        };
      }
    }

    counts[entry.outcome]++;
    if (entry.outcome !== "notArchive") rows.push(entry);
  }

  return { considered: stored.length, counts, rows };
}

/**
 * Stage 3 — queue a reading for every stored attachment that has none.
 *
 * The SAME queue and the SAME options the worker uses after a fetch, so a file
 * caught up here is read by exactly the code that reads a file that arrived
 * normally — including the retry policy, and including the singleton key that
 * makes running this during a poll safe.
 *
 * Children are included, and that is the reason for the order: a file inside
 * `dossier.zip` is where the CCTP is, and its row did not exist until stage 2
 * wrote it.
 */
export async function catchUpText(options: { dryRun?: boolean } = {}): Promise<TextStage> {
  const dryRun = options.dryRun ?? false;

  const stored = await db
    .select({
      id: intakeAttachment.id,
      filename: intakeAttachment.filename,
      contentType: intakeAttachment.contentType,
    })
    .from(intakeAttachment)
    .where(isNotNull(intakeAttachment.storagePath))
    .orderBy(intakeAttachment.filename);

  // One query for the whole set rather than one per file: a left join would
  // duplicate a row if an attachment ever carried two dossiers, and the count
  // of files this reports must not depend on that never happening.
  const read = await db
    .select({ attachmentId: intakeDossier.attachmentId })
    .from(intakeDossier)
    .where(isNotNull(intakeDossier.attachmentId));
  const hasDossier = new Set(read.map((row) => row.attachmentId));

  const counts = { ...NO_TEXT_OUTCOMES };
  const rows: TextCatchUpRow[] = [];

  for (const row of stored) {
    let entry: TextCatchUpRow;

    if (!dossierKindOf(row.filename, row.contentType)) {
      entry = {
        attachmentId: row.id,
        filename: row.filename,
        outcome: "notReadable",
        reason: row.filename.split(".").pop()?.toLowerCase() ?? "unknown",
      };
    } else if (hasDossier.has(row.id)) {
      entry = { attachmentId: row.id, filename: row.filename, outcome: "already" };
    } else if (dryRun) {
      entry = { attachmentId: row.id, filename: row.filename, outcome: "wouldQueue" };
    } else {
      try {
        const job = await enqueue(
          QUEUES.dossierRead,
          { attachmentId: row.id } satisfies DossierReadJob,
          dossierReadOptions(row.id),
        );
        entry = {
          attachmentId: row.id,
          filename: row.filename,
          outcome: job === null ? "deduplicated" : "queued",
        };
      } catch (error) {
        entry = {
          attachmentId: row.id,
          filename: row.filename,
          outcome: "failed",
          reason: error instanceof Error ? error.message : "unknown",
        };
      }
    }

    counts[entry.outcome]++;
    rows.push(entry);
  }

  return { considered: stored.length, counts, rows };
}

/**
 * All three stages, in the order they depend on each other.
 *
 * Reports; does not print. `scripts/backfill-attachments.ts` is what a person
 * runs, and the only thing that says any of this out loud.
 */
export async function catchUpAttachments(
  options: { dryRun?: boolean } = {},
): Promise<CatchUpReport> {
  const dryRun = options.dryRun ?? false;

  return {
    dryRun,
    bytes: await catchUpBytes({ dryRun }),
    archives: await catchUpArchives({ dryRun }),
    text: await catchUpText({ dryRun }),
  };
}
