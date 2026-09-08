import { PgBoss, type SendOptions } from "pg-boss";

/**
 * The queue. `src/jobs/` is where CLAUDE.md puts anything that runs in the
 * background, and this is the first thing in it.
 *
 * Why a queue at all, for one company on a mini PC: because the office is in
 * Adrar and the fibre goes down. Downloading a dossier is slow, depends on a
 * network nobody controls, and is worth trying again in ten minutes — and the
 * alternative, which is what this replaces, is a person watching a spinner
 * while a poll loses the whole batch on file nine of twelve.
 *
 * pg-boss keeps its jobs in the same Postgres as everything else: no Redis, no
 * second thing to back up, and no second thing to move when this leaves the
 * mini PC.
 */

export const QUEUES = {
  /** Read the mailbox: list new messages, write the rows, queue the files. */
  mailboxPoll: "mailbox.poll",
  /** Fetch one attachment's bytes into the working store. */
  attachmentFetch: "attachment.fetch",
} as const;

export type AttachmentFetchJob = { attachmentId: string };
export type MailboxPollJob = { actorId?: string };

let started: Promise<PgBoss> | null = null;

/**
 * One connection per process, started once.
 *
 * `supervise` and `schedule` are off here on purpose. Two processes talk to
 * this queue — the web app, which only ever enqueues, and the worker, which
 * does the work — and maintenance and cron belong to the worker alone. A web
 * app that also supervised would be a second scheduler racing the first every
 * time Next restarts a server instance.
 */
export async function boss(): Promise<PgBoss> {
  if (started) return started;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set — the queue has no database");

  started = (async () => {
    const instance = new PgBoss({ connectionString, supervise: false, schedule: false });
    await instance.start();
    await instance.createQueue(QUEUES.mailboxPoll);
    await instance.createQueue(QUEUES.attachmentFetch);
    return instance;
  })();

  return started;
}

/**
 * Put a job on the queue.
 *
 * Returns null when pg-boss deduplicated it — a singleton key already queued —
 * which is not a failure and is how "Sync now" pressed five times stays one
 * poll.
 */
export async function enqueue(
  name: string,
  data: object,
  options: SendOptions = {},
): Promise<string | null> {
  const instance = await boss();
  return instance.send(name, data, options);
}
