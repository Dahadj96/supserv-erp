import {
  type BackfillOutcome,
  backfillAttachmentFetches,
} from "../src/domain/intake/attachments";

/**
 * Queue the fetch for every attachment recorded before there was a fetcher.
 *
 *   pnpm backfill:attachments --dry-run     say what would happen
 *   pnpm backfill:attachments               do it
 *
 * `enqueue(QUEUES.attachmentFetch, …)` fires only inside `storeOne`, so only
 * files a NEW sync discovers are ever queued. Everything captured before
 * 1.1–1.3 has a null `storage_path` and nothing that would ever ask for it —
 * on this database, every row there is. This is the one-off that asks.
 *
 * IT NEEDS A WORKER. All this does is put jobs on the queue; `pnpm worker` is
 * what empties it. Run that first, or the counts below are a promise rather
 * than a result.
 *
 * Safe to run twice: the job's singleton key is the attachment's own row id,
 * and a row that already has bytes is not selected at all.
 */

const LABEL: Record<BackfillOutcome, string> = {
  queued: "queued",
  deduplicated: "already on the queue",
  reference: "skipped — a link, not a file",
  notInMailbox: "skipped — not in the mailbox any more",
  noMessageId: "skipped — no Graph id for the message",
  unreachable: "skipped — Graph would not answer",
};

const ORDER: BackfillOutcome[] = [
  "queued",
  "deduplicated",
  "reference",
  "notInMailbox",
  "noMessageId",
  "unreachable",
];

async function main() {
  const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--dry");

  const report = await backfillAttachmentFetches({ dryRun });

  console.log(
    `${dryRun ? "DRY RUN — nothing written, nothing queued" : "backfill"}: ` +
      `${report.rows.length} attachment(s) without bytes, across ${report.messages} message(s)`,
  );

  for (const outcome of ORDER) {
    const rows = report.rows.filter((row) => row.outcome === outcome);
    if (rows.length === 0) continue;

    console.log(`\n${LABEL[outcome]} — ${rows.length}`);
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
  console.log(
    `\nlisting entries carrying @odata.type: ${report.typed} of ${report.typed + report.untyped}`,
  );

  if (!dryRun) {
    console.log("\nJobs are queued. `pnpm worker` is what fetches them — watch its output.");
  }

  process.exit(0);
}

main();
