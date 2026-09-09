import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { intakeAttachment, intakeMessage } from "@/db/schema/intake";
import { storagePathFor } from "@/domain/intake/attachments";
import { catchUpArchives, catchUpAttachments, catchUpText } from "@/domain/intake/catch-up";
import { storageFor } from "@/storage";
import { buildZip } from "../helpers/zip";

/**
 * 1.11 — what is already stored catches up with what wave 1 learned to do.
 *
 * The bug this covers is the same one three times: every capability in wave 1
 * runs ON ARRIVAL, so a row that was already there is never revisited. What is
 * tested here is the catch-up's own contract, not the work it delegates —
 * `expandArchiveFor` and `readAttachmentIntoDossier` have their own suites.
 *
 *   THE ORDER, which is the whole design: a file inside an archive is queued
 *   for reading in the SAME run that unpacked it, and it could not be if the
 *   text stage ran first or ran off a snapshot taken before it.
 *
 *   IDEMPOTENCE, because this is a thing somebody will run twice: the second
 *   run must expand nothing and queue nothing.
 *
 *   THE DRY RUN writing nothing, which is what makes it safe to look first.
 */

// The queue is not under test, and starting pg-boss would create its schema in
// the shared test database. The mock keeps the one behaviour this file depends
// on: pg-boss refuses a job whose singleton key is already queued, and that
// refusal is what makes running the catch-up twice safe rather than doubling.
vi.mock("@/jobs/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/jobs/queue")>();
  const seen = new Set<string>();
  return {
    ...actual,
    enqueue: vi.fn(
      async (_name: string, _data: object, options: { singletonKey?: string } = {}) => {
        const key = options.singletonKey ?? "";
        if (seen.has(key)) return null;
        seen.add(key);
        return "job-id";
      },
    ),
  };
});

// The mailbox is not under test either, and the bytes stage lists a message
// live. Refusing the listing is the honest stand-in: every row still without
// bytes is reported `unreachable`, and nothing here asks Graph for anything.
vi.mock("@/capture/mail/graph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/capture/mail/graph")>();
  return {
    ...actual,
    fetchAttachments: vi.fn().mockRejectedValue(new Error("no mailbox in a test")),
  };
});

const queue = await import("@/jobs/queue");

const stamp = Date.now().toString().slice(-6);

const CCTP = Buffer.from(`%PDF-1.4 cahier des charges ${stamp}`, "utf8");
const ANNEXE = Buffer.from(`PK annexe ${stamp}`, "utf8");

/** A dossier holding one file each reader can take and one it cannot. */
const DOSSIER = buildZip([
  { name: "CCTP.pdf", body: CCTP },
  { name: "annexes/exigences.docx", body: ANNEXE },
]);

let messageId = "";
let archiveId = "";
let letterId = "";
let legacyId = "";
let imageId = "";
let unfetchedId = "";

async function children() {
  return db
    .select({ id: intakeAttachment.id, filename: intakeAttachment.filename })
    .from(intakeAttachment)
    .where(eq(intakeAttachment.parentAttachmentId, archiveId));
}

beforeAll(async () => {
  const [message] = await db
    .insert(intakeMessage)
    .values({
      channelKey: "mailbox",
      externalId: `graph-msg-catchup-${stamp}`,
      receivedAt: new Date(),
      fromAddress: `client-${stamp}@example.test`,
      subject: `Appel d'offres ${stamp}`,
      status: "needs_review",
    })
    .returning({ id: intakeMessage.id });

  messageId = message?.id as string;

  const rows = await db
    .insert(intakeAttachment)
    .values([
      {
        messageId,
        filename: `dossier-${stamp}.zip`,
        contentType: "application/x-zip-compressed",
        sizeBytes: DOSSIER.byteLength,
        looksLike: "tender_dossier",
      },
      {
        messageId,
        filename: `lettre-${stamp}.pdf`,
        contentType: "application/pdf",
        sizeBytes: CCTP.byteLength,
        looksLike: "unknown",
      },
      // A .doc from 2003. Real: one of the eight files in the dossier Abdou was
      // actually sent is one, and nothing in this repository reads the format.
      {
        messageId,
        filename: `exigences-${stamp}.doc`,
        contentType: null,
        sizeBytes: 12,
        looksLike: "unknown",
      },
      {
        messageId,
        filename: `photo-${stamp}.jpg`,
        contentType: "image/jpeg",
        sizeBytes: 12,
        looksLike: "unknown",
      },
      // No bytes: the bytes stage's business, and invisible to the other two.
      {
        messageId,
        filename: `pas-encore-${stamp}.pdf`,
        contentType: "application/pdf",
        sizeBytes: 12,
        looksLike: "unknown",
      },
    ])
    .returning({ id: intakeAttachment.id });

  archiveId = rows[0]?.id as string;
  letterId = rows[1]?.id as string;
  legacyId = rows[2]?.id as string;
  imageId = rows[3]?.id as string;
  unfetchedId = rows[4]?.id as string;

  // The bytes, where the fetcher (1.2) or the backfill (1.10) would have put
  // them — which is the whole premise: these files are already stored, and
  // nothing will ever fetch them again.
  const store = storageFor("working");
  for (const [id, body] of [
    [archiveId, DOSSIER],
    [letterId, CCTP],
    [legacyId, Buffer.from("legacy")],
    [imageId, Buffer.from("jpeg")],
  ] as const) {
    const [row] = await db
      .select({ filename: intakeAttachment.filename })
      .from(intakeAttachment)
      .where(eq(intakeAttachment.id, id));
    const path = storagePathFor(id, row?.filename as string);
    await store.put({ path, body, mime: "application/octet-stream" });
    await db.update(intakeAttachment).set({ storagePath: path }).where(eq(intakeAttachment.id, id));
  }
});

afterAll(async () => {
  if (!messageId) return;

  const rows = await db
    .select({ id: intakeAttachment.id })
    .from(intakeAttachment)
    .where(eq(intakeAttachment.messageId, messageId));

  // The bytes go too. Screen 66 reports files no row claims, and a suite that
  // leaves its own behind makes that report lie.
  const base = process.env.STORAGE_LOCAL_PATH ?? resolve(process.cwd(), ".data", "files");
  for (const row of rows) {
    await rm(resolve(base, "attachments", row.id), { recursive: true, force: true });
  }

  await db
    .delete(auditEntry)
    .where(inArray(auditEntry.entityId, rows.map((row) => row.id).concat(messageId)));
  await db.delete(intakeMessage).where(eq(intakeMessage.id, messageId));
});

describe("a dry run says what would happen and changes nothing", () => {
  it("names the archive nobody has opened, without opening it", async () => {
    const stage = await catchUpArchives({ dryRun: true });
    const row = stage.rows.find((entry) => entry.attachmentId === archiveId);

    expect(row?.outcome).toBe("wouldExpand");
    expect(await children()).toHaveLength(0);
  });

  it("queues nothing for reading", async () => {
    const before = vi.mocked(queue.enqueue).mock.calls.length;
    const stage = await catchUpText({ dryRun: true });

    expect(stage.rows.find((row) => row.attachmentId === letterId)?.outcome).toBe("wouldQueue");
    expect(vi.mocked(queue.enqueue).mock.calls.length).toBe(before);
  });
});

describe("one run brings every stored attachment up to date", () => {
  it("expands the archive whose bytes were already here", async () => {
    const report = await catchUpAttachments();
    const row = report.archives.rows.find((entry) => entry.attachmentId === archiveId);

    expect(row?.outcome).toBe("expanded");
    expect(row?.files).toBe(2);
    // Sorted here rather than in the query: what the rows are is the
    // assertion, and the database's collation is not.
    expect((await children()).map((child) => child.filename).sort()).toEqual([
      "CCTP.pdf",
      "annexes/exigences.docx",
    ]);
  });

  it("queues the files that came OUT of the archive in the same run", async () => {
    // The order is the design: those rows did not exist when the run started.
    const ids = (await children()).map((child) => child.id);
    const read = vi
      .mocked(queue.enqueue)
      .mock.calls.filter((call) => call[0] === queue.QUEUES.dossierRead)
      .map((call) => (call[1] as { attachmentId: string }).attachmentId);

    expect(ids).toHaveLength(2);
    for (const id of ids) expect(read).toContain(id);
  });

  it("queues a reading the way the worker does, so one path reads every file", async () => {
    const call = vi
      .mocked(queue.enqueue)
      .mock.calls.find((entry) => (entry[1] as { attachmentId: string }).attachmentId === letterId);

    expect(call?.[0]).toBe(queue.QUEUES.dossierRead);
    expect(call?.[2]).toEqual(queue.dossierReadOptions(letterId));
  });

  it("names the kinds nothing can read rather than leaving them out", async () => {
    const stage = await catchUpText();
    const outcome = (id: string) => stage.rows.find((row) => row.attachmentId === id);

    expect(outcome(legacyId)?.outcome).toBe("notReadable");
    expect(outcome(legacyId)?.reason).toBe("doc");
    expect(outcome(imageId)?.outcome).toBe("notReadable");
    // The archive itself is not read: it was expanded, and what came out of it
    // is what carries text.
    expect(outcome(archiveId)?.outcome).toBe("notReadable");
  });

  it("leaves an attachment with no bytes to the bytes stage alone", async () => {
    const report = await catchUpAttachments();

    expect(report.text.rows.some((row) => row.attachmentId === unfetchedId)).toBe(false);
    expect(report.archives.rows.some((row) => row.attachmentId === unfetchedId)).toBe(false);
    expect(report.bytes.report.rows.some((row) => row.attachmentId === unfetchedId)).toBe(true);
  });
});

describe("running it again does nothing, which is what makes it safe to run", () => {
  it("does not unpack a dossier twice", async () => {
    const stage = await catchUpArchives();

    expect(stage.rows.find((row) => row.attachmentId === archiveId)?.outcome).toBe("already");
    expect(await children()).toHaveLength(2);
  });

  it("does not queue a second reading for a file already on the queue", async () => {
    const stage = await catchUpText();

    expect(stage.rows.find((row) => row.attachmentId === letterId)?.outcome).toBe("deduplicated");
  });

  it("counts every file it looked at, so no bucket can hide one", async () => {
    const stage = await catchUpText();
    const counted = Object.values(stage.counts).reduce((total, n) => total + n, 0);

    expect(counted).toBe(stage.considered);
    expect(stage.counts.failed).toBe(0);
  });
});
