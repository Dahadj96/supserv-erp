import { type Job, PgBoss } from "pg-boss";
import { MailboxNotScoped } from "@/capture/mail/graph";
import { expandArchiveFor } from "@/domain/intake/archive";
import { fetchAttachmentFor } from "@/domain/intake/attachments";
import { pollMailbox } from "@/domain/intake/mailbox";
import { type AttachmentFetchJob, type MailboxPollJob, QUEUES } from "./queue";

/**
 * `pnpm worker`, and `node dist/jobs/worker.js` in the compose file that has
 * declared this service since before there was anything to run.
 *
 * It is a separate process from the web app for the reason CLAUDE.md gives:
 * anything that needs the network — mail, filing — retries in the background
 * rather than being something a person waits on. The web app enqueues; this
 * empties the queue.
 *
 * This is the one place in the repository that writes to the console, and it
 * should stay that way. A worker with no terminal output is a worker nobody can
 * tell is alive; a domain function that logs is a domain function that has
 * decided who is listening.
 */

const POLL_EVERY = process.env.MAILBOX_POLL_CRON ?? "*/10 * * * *";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set — the worker has no database");

  const boss = new PgBoss({ connectionString });

  boss.on("error", (error: unknown) => console.error("[worker] queue error", error));

  await boss.start();
  await boss.createQueue(QUEUES.mailboxPoll);
  await boss.createQueue(QUEUES.attachmentFetch);

  /**
   * Capture on a clock, not only on a press.
   *
   * "Sync now" still works and still enqueues this same job — but an ERP that
   * only reads the mailbox when somebody remembers to press a button is a
   * mailbox somebody still has to watch, which is the thing being replaced.
   */
  await boss.schedule(QUEUES.mailboxPoll, POLL_EVERY, null, { singletonKey: QUEUES.mailboxPoll });

  await boss.work<MailboxPollJob>(QUEUES.mailboxPoll, async (jobs: Job<MailboxPollJob>[]) => {
    for (const job of jobs) {
      try {
        const result = await pollMailbox(job.data?.actorId ?? "mailbox-poll");
        console.log(
          `[worker] poll: ${result.stored} stored, ${result.skipped} already known, ` +
            `${result.needsReview} need review`,
        );
      } catch (error) {
        if (error instanceof MailboxNotScoped) {
          // Not a bad day: a configuration that has not been done. Retrying it
          // every minute until the retry limit runs out would fill the queue
          // with the same refusal and tell nobody. Screen 38 is where this is
          // said, and it says it from the same guard.
          console.error(`[worker] poll refused: ${error.detail}`);
          continue;
        }
        throw error;
      }
    }
  });

  await boss.work<AttachmentFetchJob>(
    QUEUES.attachmentFetch,
    async (jobs: Job<AttachmentFetchJob>[]) => {
      for (const job of jobs) {
        const { attachmentId } = job.data;
        const { outcome, reason } = await fetchAttachmentFor(attachmentId);

        console.log(
          `[worker] attachment ${attachmentId}: ${outcome}${reason ? ` — ${reason}` : ""}`,
        );

        /*
          AN ARCHIVE IS OPENED ONCE ITS BYTES ARE HERE.

          Here rather than inside `fetchAttachmentFor` for the same reason the
          fetch reports instead of deciding: unpacking is local work on bytes
          that have already arrived, and every way it can fail is terminal —
          a zip bomb, a corrupt file, a `.zip` that is not one. Making the
          fetch job fail on it would pull 12 MB over the fibre again to be
          refused again, five times.

          `already` counts as well as `stored`: a queue may deliver the same
          job twice, and a delivery that stored the bytes and then died before
          unpacking must be finishable by the next one. The archive's own row
          is the guard against doing it twice.
        */
        if (outcome === "stored" || outcome === "already") {
          const expansion = await expandArchiveFor(attachmentId);
          if (expansion.outcome !== "notArchive") {
            console.log(
              `[worker] archive ${attachmentId}: ${expansion.outcome}` +
                `${expansion.files !== undefined ? ` — ${expansion.files} files` : ""}` +
                `${expansion.reason ? ` — ${expansion.reason}` : ""}` +
                `${expansion.refused?.length ? `, ${expansion.refused.length} refused` : ""}`,
            );
          }
        }

        // The only outcome worth trying again. `linked` has no bytes to fetch and
        // `gone` has no row to fetch them for; throwing on either would keep the
        // queue asking a question that has already been answered.
        if (outcome === "failed") {
          throw new Error(
            `attachment ${attachmentId} could not be fetched: ${reason ?? "unknown"}`,
          );
        }
      }
    },
  );

  console.log(`[worker] up. mailbox poll ${POLL_EVERY}`);
}

main().catch((error) => {
  // A worker that dies quietly is worse than one that does not start. Compose
  // restarts it; the exit code is what tells it to.
  console.error("[worker] failed to start", error);
  process.exit(1);
});
