import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { intakeAttachment, intakeMessage } from "@/db/schema/intake";
import { fileByIndexId } from "@/domain/files";
import { MAILBOX, pollMailbox } from "@/domain/intake/mailbox";
import { storageFor } from "@/storage";
import { sha256 } from "@/storage/local";

/**
 * 1.2 — the envelope stops being a list of names.
 *
 * Before this, `intake_attachment` held a filename and a null `storage_path`
 * forever, `/api/files/attachment:<id>` answered 409 for every attachment the
 * company had ever been sent, and the only way to read a CCTP was Outlook.
 *
 * What is worth pinning is not "a file was written". It is that the three
 * outcomes stay distinguishable — bytes stored, nothing to store, could not
 * store — because 1.3 turns exactly this into a retrying job, and a job that
 * cannot tell a OneDrive link from a flaky link retries the link forever.
 */

vi.mock("@/capture/mail/graph", async (importOriginal) => {
  // The real error classes: `fetchInto` dispatches on `instanceof`, so a mock
  // that invented its own would prove nothing about the code under test.
  const actual = await importOriginal<typeof import("@/capture/mail/graph")>();
  return {
    ...actual,
    fetchMessagesSince: vi.fn(),
    fetchAttachments: vi.fn(),
    fetchAttachmentBytes: vi.fn(),
  };
});

const graph = await import("@/capture/mail/graph");
const { AttachmentHasNoBytes, REFERENCE_ATTACHMENT } = graph;

const stamp = Date.now().toString().slice(-6);
const ACTOR = "test-mailbox-attachments";

/** The bytes of the "dossier" — a real digest, so sha256 is checked and not echoed. */
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

  vi.mocked(graph.fetchAttachmentBytes).mockImplementation(
    async (_messageId: string, _attachmentId: string, odataType?: string | null) => {
      if (odataType === REFERENCE_ATTACHMENT) {
        throw new AttachmentHasNoBytes("This attachment is a link to a file in the cloud.");
      }
      if (_messageId.endsWith("-3")) throw new Error("Graph /users/… failed: 500");
      return { bytes: CCTP, contentType: "application/pdf", kind: "file" as const };
    },
  );

  await pollMailbox(ACTOR);

  // Only the three this file put there; the suite shares one database. Ordered
  // by the Graph id, which ends in 1, 2, 3 — so the index below is the message.
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

  await db.delete(auditEntry).where(inArray(auditEntry.entityId, messageIds));
  // `intake_attachment.message_id` is ON DELETE cascade.
  await db.delete(intakeMessage).where(inArray(intakeMessage.id, messageIds));
});

/** The attachment rows of one of this file's messages, by its subject. */
async function attachmentsOf(index: number) {
  const id = messageIds[index] as string;
  return db.select().from(intakeAttachment).where(eq(intakeAttachment.messageId, id));
}

describe("a file that arrived in the mail", () => {
  it("has a storage path and a digest, where it had neither", async () => {
    const [row] = await attachmentsOf(0);

    expect(row?.filename).toBe("cctp.pdf");
    expect(row?.storagePath).toBe(`attachments/${row?.id}/cctp.pdf`);
    expect(row?.sha256).toBe(sha256(CCTP));
  });

  it("hands back the same bytes it was sent", async () => {
    const [row] = await attachmentsOf(0);
    const body = await storageFor("working").get(row?.storagePath as string);

    expect(body.equals(CCTP)).toBe(true);
  });

  it("records the length of the copy it holds, not the mail store's estimate", async () => {
    const [row] = await attachmentsOf(0);

    // Graph said 4096 — an attachment's size in the mail store carries its
    // encoding. The row should say what screen 60 will actually hand over.
    expect(row?.sizeBytes).toBe(CCTP.byteLength);
  });

  it("is what stops /api/files/attachment:<id> answering 409", async () => {
    const [row] = await attachmentsOf(0);
    const found = await fileByIndexId(`attachment:${row?.id}`);

    // The route's 409 is `if (!path)` and nothing else. This is that branch,
    // read through the same lookup the route uses.
    expect(found?.storagePath).toBeTruthy();
    expect(await storageFor("working").get(found?.storagePath as string)).toHaveLength(
      CCTP.byteLength,
    );
  });
});

describe("a file that did not arrive in the mail", () => {
  it("keeps a null path for a link, and stores the message anyway", async () => {
    const [row] = await attachmentsOf(1);

    expect(row?.filename).toBe("dossier.pdf");
    // Not a failure. There are no bytes in the mailbox to fetch, and the row
    // saying so is what screen 60 reads to explain itself.
    expect(row?.storagePath).toBeNull();
    expect(row?.sha256).toBeNull();
  });

  it("keeps a null path when the fetch failed, and still stores the message", async () => {
    const [row] = await attachmentsOf(2);

    // The message is the record that the mail exists. Losing it because an
    // attachment would not download is the failure this must never become.
    expect(row?.filename).toBe("bordereau.pdf");
    expect(row?.storagePath).toBeNull();
  });
});

describe("the audit says what happened to the envelope", () => {
  async function captureFor(index: number) {
    const [entry] = await db
      .select({ after: auditEntry.after })
      .from(auditEntry)
      .where(eq(auditEntry.entityId, messageIds[index] as string));
    return (entry?.after ?? {}) as {
      attachments?: {
        total: number;
        stored: number;
        linked: number;
        failed: number;
        failures?: { file: string; reason: string }[];
      };
    };
  }

  it("counts the one it stored", async () => {
    expect((await captureFor(0)).attachments).toMatchObject({ total: 1, stored: 1, failed: 0 });
  });

  it("separates a link from a failure", async () => {
    // The distinction 1.3 depends on: `failed` is retried, `linked` never is.
    expect((await captureFor(1)).attachments).toMatchObject({ linked: 1, failed: 0 });
    expect((await captureFor(2)).attachments).toMatchObject({ linked: 0, failed: 1 });
  });

  it("names the file that failed and why, since nothing in this layer logs", async () => {
    const { attachments } = await captureFor(2);

    expect(attachments?.failures?.[0]?.file).toBe("bordereau.pdf");
    expect(attachments?.failures?.[0]?.reason).toContain("500");
  });
});
