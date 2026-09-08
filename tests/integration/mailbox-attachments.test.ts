import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { intakeAttachment, intakeMessage } from "@/db/schema/intake";
import { fileByIndexId } from "@/domain/files";
import { fetchAttachmentFor } from "@/domain/intake/attachments";
import { pollMailbox } from "@/domain/intake/mailbox";
import { enqueue, QUEUES } from "@/jobs/queue";
import { storageFor } from "@/storage";
import { sha256 } from "@/storage/local";

/**
 * 1.2 and 1.3 — the envelope stops being a list of names, and stops being
 * something a person waits for.
 *
 * Before these, `intake_attachment` held a filename and a null `storage_path`
 * forever, `/api/files/attachment:<id>` answered 409 for every attachment the
 * company had ever been sent, and the only way to read a CCTP was Outlook.
 *
 * The poll now only NOTICES files; a job fetches them. So the two halves are
 * tested where they are: that the poll queues exactly what can be fetched, and
 * that fetching keeps its outcomes distinguishable — because the worker retries
 * `failed` and must never retry `linked`, `gone` or `already`.
 */

vi.mock("@/capture/mail/graph", async (importOriginal) => {
  // The real error classes: the fetcher dispatches on `instanceof`, so a mock
  // that invented its own would prove nothing about the code under test.
  const actual = await importOriginal<typeof import("@/capture/mail/graph")>();
  return {
    ...actual,
    fetchMessagesSince: vi.fn(),
    fetchAttachments: vi.fn(),
    fetchAttachmentBytes: vi.fn(),
  };
});

// The queue itself is not under test here, and starting pg-boss would create
// its schema in the shared test database for the sake of counting two calls.
vi.mock("@/jobs/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/jobs/queue")>();
  return { ...actual, enqueue: vi.fn().mockResolvedValue("job-id") };
});

const graph = await import("@/capture/mail/graph");
const { AttachmentHasNoBytes, REFERENCE_ATTACHMENT } = graph;

const stamp = Date.now().toString().slice(-6);
const ACTOR = "test-mailbox-attachments";

/** The bytes of the "dossier" — real content, so the digest is checked and not echoed. */
const CCTP = Buffer.from(`%PDF-1.4 cahier des charges ${stamp}`, "utf8");

const message = (n: number, subject: string) => ({
  id: `graph-msg-${stamp}-${n}`,
  receivedDateTime: new Date().toISOString(),
  subject,
  bodyPreview: subject,
  body: { contentType: "text", content: subject },
  from: { emailAddress: { name: "Client", address: `client-${stamp}@example.test` } },
  hasAttachments: true,
  internetMessageId: `<${stamp}-${n}@example.test>`,
  webLink: "https://outlook.office.com/mail/test",
});

const attachment = (name: string, odataType?: string) => ({
  id: `graph-att-${stamp}-${name}`,
  name,
  contentType: "application/pdf",
  size: 4096,
  isInline: false,
  ...(odataType ? { "@odata.type": odataType } : {}),
});

let messageIds: string[] = [];

beforeAll(async () => {
  const arrived = [
    message(1, `Consultation ${stamp}`),
    message(2, `Dossier volumineux ${stamp}`),
    message(3, `Relance ${stamp}`),
  ];

  vi.mocked(graph.fetchMessagesSince).mockResolvedValue(arrived);

  vi.mocked(graph.fetchAttachments).mockImplementation(async (id: string) => {
    if (id.endsWith("-1")) return [attachment("cctp.pdf")];
    // A 400 MB dossier does not travel as bytes; it travels as a link.
    if (id.endsWith("-2")) return [attachment("dossier.pdf", REFERENCE_ATTACHMENT)];
    return [attachment("bordereau.pdf")];
  });

  // Dispatched on the attachment id, because the job fetches by id alone — ten
  // minutes later, the listing that knew the kind is long gone.
  vi.mocked(graph.fetchAttachmentBytes).mockImplementation(
    async (_messageId: string, attachmentId: string) => {
      if (attachmentId.endsWith("dossier.pdf")) {
        throw new AttachmentHasNoBytes("This attachment is a link to a file in the cloud.");
      }
      if (attachmentId.endsWith("bordereau.pdf")) throw new Error("Graph /users/… failed: 500");
      return { bytes: CCTP, contentType: "application/pdf", kind: "file" as const };
    },
  );

  await pollMailbox(ACTOR);

  // Ordered by the Graph id, which ends in 1, 2, 3 — so the index below is the
  // message. The suite shares one database, so only these three are taken.
  const mine = await db
    .select({ id: intakeMessage.id })
    .from(intakeMessage)
    .where(
      inArray(
        intakeMessage.externalId,
        arrived.map((m) => m.id),
      ),
    )
    .orderBy(intakeMessage.externalId);

  expect(mine).toHaveLength(3);
  messageIds = mine.map((m) => m.id);
});

afterAll(async () => {
  if (messageIds.length === 0) return;

  const rows = await db
    .select({ id: intakeAttachment.id })
    .from(intakeAttachment)
    .where(inArray(intakeAttachment.messageId, messageIds));

  // The bytes go too. Screen 66 walks the working store looking for files no
  // row claims, and a suite that leaves its own behind makes that report lie.
  const base = process.env.STORAGE_LOCAL_PATH ?? resolve(process.cwd(), ".data", "files");
  for (const row of rows) {
    await rm(resolve(base, "attachments", row.id), { recursive: true, force: true });
  }

  await db
    .delete(auditEntry)
    .where(inArray(auditEntry.entityId, messageIds.concat(rows.map((r) => r.id))));
  // `intake_attachment.message_id` is ON DELETE cascade.
  await db.delete(intakeMessage).where(inArray(intakeMessage.id, messageIds));
});

/** The single attachment of one of this file's three messages. */
async function attachmentOf(index: number) {
  const id = messageIds[index] as string;
  const [row] = await db.select().from(intakeAttachment).where(eq(intakeAttachment.messageId, id));
  return row;
}

describe("the poll queues the files rather than waiting for them", () => {
  it("keeps the id Graph knows the attachment by", async () => {
    // The job runs later and has nothing else to ask Graph for.
    expect((await attachmentOf(0))?.externalId).toBe(`graph-att-${stamp}-cctp.pdf`);
  });

  it("queues one retrying job per fetchable attachment", async () => {
    const rowId = (await attachmentOf(0))?.id;
    const call = vi
      .mocked(enqueue)
      .mock.calls.find(([, data]) => (data as { attachmentId?: string }).attachmentId === rowId);

    expect(call?.[0]).toBe(QUEUES.attachmentFetch);
    // The singleton key is what stops two overlapping polls queueing the same
    // file twice; the retry is the fibre link in Adrar going down mid-dossier.
    expect(call?.[2]).toMatchObject({ singletonKey: rowId, retryLimit: 5, retryBackoff: true });
  });

  it("never queues a link, because there is nothing to fetch", async () => {
    const rowId = (await attachmentOf(1))?.id;
    const queued = vi
      .mocked(enqueue)
      .mock.calls.some(([, data]) => (data as { attachmentId?: string }).attachmentId === rowId);

    // Queueing it would be queueing a fact, and the queue would keep asking.
    expect(queued).toBe(false);
  });
});

describe("fetching a file that arrived in the mail", () => {
  it("writes a storage path and a digest, where there had been neither", async () => {
    const row = await attachmentOf(0);
    const result = await fetchAttachmentFor(row?.id as string);
    expect(result.outcome).toBe("stored");

    const after = await attachmentOf(0);
    expect(after?.storagePath).toBe(`attachments/${row?.id}/cctp.pdf`);
    expect(after?.sha256).toBe(sha256(CCTP));
    // Graph said 4096 — an attachment's size in the mail store carries its
    // encoding. The row should say what screen 60 will actually hand over.
    expect(after?.sizeBytes).toBe(CCTP.byteLength);
  });

  it("hands back the same bytes it was sent", async () => {
    const row = await attachmentOf(0);
    expect((await storageFor("working").get(row?.storagePath as string)).equals(CCTP)).toBe(true);
  });

  it("is what stops /api/files/attachment:<id> answering 409", async () => {
    const row = await attachmentOf(0);
    const found = await fileByIndexId(`attachment:${row?.id}`);

    // The route's 409 is `if (!path)` and nothing else. This is that branch,
    // read through the same lookup the route uses.
    expect(found?.storagePath).toBeTruthy();
    expect(await storageFor("working").get(found?.storagePath as string)).toHaveLength(
      CCTP.byteLength,
    );
  });

  it("does not fetch it a second time when the job is delivered twice", async () => {
    const row = await attachmentOf(0);
    const calls = vi.mocked(graph.fetchAttachmentBytes).mock.calls.length;

    expect((await fetchAttachmentFor(row?.id as string)).outcome).toBe("already");
    // A queue may deliver twice. Pulling 12 MB again to write the same bytes
    // is not free on this link.
    expect(vi.mocked(graph.fetchAttachmentBytes).mock.calls.length).toBe(calls);
  });
});

describe("the outcomes the worker decides on", () => {
  it("a link is answered, not retried", async () => {
    const row = await attachmentOf(1);
    const result = await fetchAttachmentFor(row?.id as string);

    expect(result.outcome).toBe("linked");
    // Not a failure. There are no bytes in the mailbox to fetch, and the null
    // path is what screen 60 reads to explain itself.
    expect((await attachmentOf(1))?.storagePath).toBeNull();
  });

  it("a bad day is a failure, so the worker tries again", async () => {
    const row = await attachmentOf(2);
    const result = await fetchAttachmentFor(row?.id as string);

    expect(result.outcome).toBe("failed");
    expect(result.reason).toContain("500");
    expect((await attachmentOf(2))?.storagePath).toBeNull();
  });

  it("a row that is no longer there is gone, not failed", async () => {
    // The message was dismissed while the job sat in the queue. Retrying it
    // until the limit runs out would be retrying a deletion.
    const result = await fetchAttachmentFor("00000000-0000-4000-8000-000000000000");
    expect(result.outcome).toBe("gone");
  });
});

describe("what became of each file is written down", () => {
  it("leaves a fetch entry naming the outcome, since nothing in this layer logs", async () => {
    const row = await attachmentOf(2);
    const entries = await db
      .select({ after: auditEntry.after })
      .from(auditEntry)
      .where(eq(auditEntry.entityId, row?.id as string));

    const outcomes = entries.map((e) => (e.after as { outcome?: string }).outcome);
    expect(outcomes).toContain("failed");

    const first = entries[0]?.after as { file?: string } | undefined;
    expect(first?.file).toBe("bordereau.pdf");
  });

  it("the capture entry says what the poll did with the envelope", async () => {
    const [entry] = await db
      .select({ after: auditEntry.after })
      .from(auditEntry)
      .where(eq(auditEntry.entityId, messageIds[1] as string));

    const after = entry?.after as { attachments?: object } | undefined;
    expect(after?.attachments).toMatchObject({
      total: 1,
      queued: 0,
      linked: 1,
    });
  });
});
