import type { BackfillOutcome } from "../src/domain/intake/attachments";
import {
  type ArchiveOutcome,
  type ArchiveStage,
  type BytesStage,
  catchUpAttachments,
  type TextOutcome,
  type TextStage,
} from "../src/domain/intake/catch-up";

/**
 * Bring every attachment ALREADY IN THE DATABASE up to date with everything
 * wave 1 has since learned to do.
 *
 *   pnpm backfill:attachments --dry-run     say what would happen
 *   pnpm backfill:attachments               do it
 *
 * Three stages, in the order they depend on each other — bytes, then archive
 * expansion, then text. Each is a no-op on what is already done, so this is
 * safe to run as often as anybody likes, and running it after a normal sync
 * does nothing at all. Why it has to exist, and why it is one tool rather than
 * three, is written at the top of `src/domain/intake/catch-up.ts`.
 *
 * IT NEEDS A WORKER. Stages 1 and 3 put jobs on the queue; `pnpm worker` is
 * what empties it. Run that first, or those counts are a promise rather than a
 * result. Stage 2 is the exception — unpacking is local work on bytes that are
 * already here, so it happens as this runs.
 *
 * TWO RUNS TO CONVERGE, on a database whose attachments have no bytes yet.
 * Stage 1 queues a fetch; the bytes arrive minutes later, and the worker
 * expands and reads them itself on the normal path — so nothing is lost, and a
 * second run is what proves it rather than what performs it.
 */

const BYTES_LABEL: Record<BackfillOutcome, string> = {
  queued: "queued",
  deduplicated: "already on the queue",
  reference: "skipped — a link, not a file",
  notInMailbox: "skipped — not in the mailbox any more",
  noMessageId: "skipped — no Graph id for the message",
  unreachable: "skipped — Graph would not answer",
};

const BYTES_ORDER: BackfillOutcome[] = [
  "queued",
  "deduplicated",
  "reference",
  "notInMailbox",
  "noMessageId",
  "unreachable",
];

const ARCHIVE_LABEL: Record<ArchiveOutcome, string> = {
  expanded: "expanded",
  wouldExpand: "would be expanded",
  already: "already expanded",
  notArchive: "not an archive",
  noBytes: "no copy here to open",
  nested: "inside another archive — never opened",
  refused: "refused — terminal, nothing retries it",
  failed: "failed to write",
};

const ARCHIVE_ORDER: ArchiveOutcome[] = [
  "expanded",
  "wouldExpand",
  "already",
  "refused",
  "failed",
  "noBytes",
  "nested",
  "notArchive",
];

const TEXT_LABEL: Record<TextOutcome, string> = {
  queued: "queued for reading",
  wouldQueue: "would be queued for reading",
  deduplicated: "already on the queue",
  already: "already read",
  notReadable: "nothing here can read this kind",
  failed: "could not be queued",
};

const TEXT_ORDER: TextOutcome[] = [
  "queued",
  "wouldQueue",
  "deduplicated",
  "already",
  "failed",
  "notReadable",
];

function heading(n: number, title: string): void {
  console.log(`\n\n── ${n}. ${title} ${"─".repeat(Math.max(0, 46 - title.length))}`);
}

/**
 * The four numbers the run is judged on, per stage.
 *
 * They add up to everything the stage looked at, which is the point: a summary
 * whose buckets do not account for every row is a summary that can hide one.
 */
function summary(counts: {
  alreadyDone: number;
  broughtUpToDate: number;
  nothingToDo: number;
  failed: number;
}): void {
  console.log("");
  console.log(`  already done         ${String(counts.alreadyDone).padStart(4)}`);
  console.log(`  brought up to date   ${String(counts.broughtUpToDate).padStart(4)}`);
  console.log(`  nothing to do        ${String(counts.nothingToDo).padStart(4)}`);
  console.log(`  failed               ${String(counts.failed).padStart(4)}`);
}

function bytes(stage: BytesStage, dryRun: boolean): void {
  heading(1, "bytes");

  const { report } = stage;
  console.log(
    `${stage.alreadyStored} attachment(s) already have their bytes; ` +
      `${report.rows.length} without, across ${report.messages} message(s)`,
  );

  for (const outcome of BYTES_ORDER) {
    const rows = report.rows.filter((row) => row.outcome === outcome);
    if (rows.length === 0) continue;

    console.log(`\n${BYTES_LABEL[outcome]} — ${rows.length}`);
    for (const row of rows) {
      const recovered = row.idRecovered ? "  [graph id recovered]" : "";
      const reason = row.reason ? `  — ${row.reason}` : "";
      console.log(`  ${row.attachmentId}  ${row.filename}${recovered}${reason}`);
    }
  }

  // Whether a reference attachment could be recognised at all. `@odata.type` is
  // an annotation, `$select` does not name it, and if Graph leaves it out then
  // a OneDrive link cannot be skipped here — it is queued and answered 405,
  // which the fetcher reports as `linked` and the worker does not retry. Costly
  // by one request, never wrong, and worth saying out loud either way.
  if (report.typed + report.untyped > 0) {
    console.log(
      `\nlisting entries carrying @odata.type: ${report.typed} of ${report.typed + report.untyped}`,
    );
  }

  const c = report.counts;
  summary({
    alreadyDone: stage.alreadyStored,
    broughtUpToDate: dryRun ? 0 : c.queued + c.deduplicated,
    nothingToDo: c.reference + (dryRun ? c.queued + c.deduplicated : 0),
    failed: c.notInMailbox + c.noMessageId + c.unreachable,
  });
}

function archives(stage: ArchiveStage): void {
  heading(2, "archives");

  console.log(
    `${stage.considered} stored top-level attachment(s) considered; ` +
      `${stage.counts.notArchive} are not archives`,
  );

  for (const outcome of ARCHIVE_ORDER) {
    if (outcome === "notArchive") continue; // counted above; naming 37 non-events helps nobody.
    const rows = stage.rows.filter((row) => row.outcome === outcome);
    if (rows.length === 0) continue;

    console.log(`\n${ARCHIVE_LABEL[outcome]} — ${rows.length}`);
    for (const row of rows) {
      const files = row.files !== undefined ? `  — ${row.files} file(s) inside` : "";
      const refused = row.refused ? `, ${row.refused} entr(y/ies) refused` : "";
      const reason = row.reason ? `  — ${row.reason}` : "";
      console.log(`  ${row.attachmentId}  ${row.filename}${files}${refused}${reason}`);
    }
  }

  const c = stage.counts;
  summary({
    alreadyDone: c.already,
    broughtUpToDate: c.expanded + c.wouldExpand,
    nothingToDo: c.notArchive + c.nested + c.noBytes,
    failed: c.refused + c.failed,
  });
}

function text(stage: TextStage): void {
  heading(3, "text");

  console.log(`${stage.considered} stored attachment(s) considered, files inside archives included`);

  for (const outcome of TEXT_ORDER) {
    const rows = stage.rows.filter((row) => row.outcome === outcome);
    if (rows.length === 0) continue;

    console.log(`\n${TEXT_LABEL[outcome]} — ${rows.length}`);
    for (const row of rows) {
      const reason = row.reason ? `  — ${row.reason}` : "";
      console.log(`  ${row.attachmentId}  ${row.filename}${reason}`);
    }
  }

  const c = stage.counts;
  summary({
    alreadyDone: c.already,
    broughtUpToDate: c.queued + c.wouldQueue + c.deduplicated,
    nothingToDo: c.notReadable,
    failed: c.failed,
  });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--dry");

  console.log(
    dryRun
      ? "DRY RUN — nothing written, nothing queued, nothing unpacked"
      : "catch-up — bytes, then archives, then text",
  );

  const report = await catchUpAttachments({ dryRun });

  bytes(report.bytes, dryRun);
  archives(report.archives);
  text(report.text);

  if (dryRun) {
    // A dry run cannot unpack, so the files inside an archive that has not been
    // opened yet do not exist to be counted — and stage 3 cannot see them. Said
    // out loud, because a stage 3 that quietly understated itself would be read
    // as the archive holding nothing worth reading.
    const waiting = report.archives.counts.wouldExpand;
    if (waiting > 0) {
      console.log(
        `\n\n${waiting} archive(s) are not open yet, so the files inside them are not in ` +
          "stage 3's count. A real run expands them first and then counts them.",
      );
    }
  } else {
    console.log(
      "\n\nJobs are queued. `pnpm worker` is what fetches and reads them — watch its output.",
    );
  }

  process.exit(0);
}

main();
