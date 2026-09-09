import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { intakeAttachment, intakeMessage } from "@/db/schema/intake";
import { expandArchiveFor } from "@/domain/intake/archive";
import { storagePathFor } from "@/domain/intake/attachments";
import { storageFor } from "@/storage";
import { sha256 } from "@/storage/local";

/**
 * 1.4 — a `dossier.zip` becomes files a person can read.
 *
 * The reader's guards are unit-tested against hostile archives
 * (`tests/unit/zip-attachment.test.ts`). What is tested here is the part that
 * writes: that the files inside become rows with bytes behind them, that the
 * archive itself survives untouched, and that running it twice does not
 * duplicate a dossier — a queue may deliver the same job twice, and a tender
 * folder listed twice is a folder nobody can count.
 */

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A minimal ZIP: local headers, a central directory, an end record. */
function buildZip(entries: { name: string; body: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const payload = deflateRawSync(entry.body);
    const crc = crc32(entry.body);

    const local = Buffer.alloc(30 + name.byteLength);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.byteLength, 18);
    local.writeUInt32LE(entry.body.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.byteLength);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.byteLength, 20);
    central.writeUInt32LE(entry.body.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, payload);
    centrals.push(central);
    offset += local.byteLength + payload.byteLength;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.byteLength, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}

const stamp = Date.now().toString().slice(-6);

const CCTP = Buffer.from(`%PDF-1.4 cahier des charges ${stamp}`, "utf8");
const BORDEREAU = Buffer.from(`%PDF-1.4 bordereau des prix ${stamp}`, "utf8");

/** A real dossier, plus the two things a dossier must not be allowed to do. */
const DOSSIER = buildZip([
  { name: "CCTP.pdf", body: CCTP },
  { name: "annexes/bordereau des prix.pdf", body: BORDEREAU },
  { name: "annexes/plans.zip", body: Buffer.from("PK-inner") },
  { name: "../../.env", body: Buffer.from("DATABASE_URL=stolen") },
]);

let messageId = "";
let archiveId = "";
let plainId = "";

beforeAll(async () => {
  const [message] = await db
    .insert(intakeMessage)
    .values({
      channelKey: "mailbox",
      externalId: `graph-msg-archive-${stamp}`,
      receivedAt: new Date(),
      fromAddress: `client-${stamp}@example.test`,
      subject: `Appel d'offres ${stamp}`,
      status: "needs_review",
    })
    .returning({ id: intakeMessage.id });

  messageId = message?.id as string;

  const [archive, plain] = await db
    .insert(intakeAttachment)
    .values([
      {
        messageId,
        filename: "dossier.zip",
        contentType: "application/zip",
        sizeBytes: DOSSIER.byteLength,
        looksLike: "tender_dossier",
      },
      {
        messageId,
        filename: "lettre.pdf",
        contentType: "application/pdf",
        sizeBytes: CCTP.byteLength,
        looksLike: "unknown",
      },
    ])
    .returning({ id: intakeAttachment.id });

  archiveId = archive?.id as string;
  plainId = plain?.id as string;

  // The bytes, where the fetcher (1.2) would have put them.
  const store = storageFor("working");
  const archivePath = storagePathFor(archiveId, "dossier.zip");
  await store.put({ path: archivePath, body: DOSSIER, mime: "application/zip" });
  await db
    .update(intakeAttachment)
    .set({ storagePath: archivePath, sha256: sha256(DOSSIER) })
    .where(eq(intakeAttachment.id, archiveId));

  const plainPath = storagePathFor(plainId, "lettre.pdf");
  await store.put({ path: plainPath, body: CCTP, mime: "application/pdf" });
  await db
    .update(intakeAttachment)
    .set({ storagePath: plainPath })
    .where(eq(intakeAttachment.id, plainId));
});

afterAll(async () => {
  if (!messageId) return;

  const rows = await db
    .select({ id: intakeAttachment.id })
    .from(intakeAttachment)
    .where(eq(intakeAttachment.messageId, messageId));

  // The bytes go too. Screen 66 walks the working store looking for files no
  // row claims, and a suite that leaves its own behind makes that report lie.
  const base = process.env.STORAGE_LOCAL_PATH ?? resolve(process.cwd(), ".data", "files");
  for (const row of rows) {
    await rm(resolve(base, "attachments", row.id), { recursive: true, force: true });
  }

  await db
    .delete(auditEntry)
    .where(inArray(auditEntry.entityId, rows.map((r) => r.id).concat(messageId)));
  await db.delete(intakeMessage).where(eq(intakeMessage.id, messageId));
});

const children = () =>
  db
    .select()
    .from(intakeAttachment)
    .where(eq(intakeAttachment.parentAttachmentId, archiveId))
    .orderBy(intakeAttachment.filename);

describe("opening a dossier that arrived as one zip", () => {
  it("writes a row per file inside, keeping the path it had in the archive", async () => {
    const result = await expandArchiveFor(archiveId);

    expect(result.outcome).toBe("expanded");
    expect(result.files).toBe(2);

    const inside = await children();
    expect(inside.map((row) => row.filename)).toEqual([
      "CCTP.pdf",
      "annexes/bordereau des prix.pdf",
    ]);
  });

  it("puts real bytes behind each one, so the viewer has something to show", async () => {
    const store = storageFor("working");
    const [cctp, bordereau] = await children();

    expect(cctp?.storagePath).toBeTruthy();
    expect(await store.get(cctp?.storagePath as string)).toEqual(CCTP);
    expect(await store.get(bordereau?.storagePath as string)).toEqual(BORDEREAU);

    // The digest is written beside the path, the same as a fetched attachment,
    // so the same file arriving twice is still noticeable.
    expect(cctp?.sha256).toBe(sha256(CCTP));
    expect(cctp?.sizeBytes).toBe(CCTP.byteLength);
  });

  it("gives an unpacked PDF a content type, because a zip declares none", () => {
    // Nobody typed one — the format has no field for it — so the extension is
    // the only source there is, and it is what lets screen 40 preview the file
    // rather than offering a download.
    return children().then(([cctp]) => {
      expect(cctp?.contentType).toBe("application/pdf");
    });
  });

  it("asks Graph for nothing: an unpacked file was never in the mailbox", async () => {
    const inside = await children();
    // A null `external_id` is what keeps the fetcher and the backfill from ever
    // trying to download a file that only ever existed inside another one.
    for (const row of inside) expect(row.externalId).toBeNull();
  });

  it("leaves the archive exactly where it was", async () => {
    const [archive] = await db
      .select()
      .from(intakeAttachment)
      .where(eq(intakeAttachment.id, archiveId));

    // A tender dossier is evidence: what was sent is the archive, not our
    // unpacking of it, and it stays downloadable.
    expect(archive?.filename).toBe("dossier.zip");
    expect(archive?.parentAttachmentId).toBeNull();
    expect(await storageFor("working").get(archive?.storagePath as string)).toEqual(DOSSIER);
  });

  it("records what it turned away, with the reason, in the audit trail", async () => {
    const [entry] = await db
      .select()
      .from(auditEntry)
      .where(eq(auditEntry.entityId, archiveId))
      .orderBy(auditEntry.at);

    const after = entry?.after as { refused?: { path: string; reason: string }[] };
    expect(entry?.action).toBe("expand");
    expect(after.refused).toEqual([
      { path: "annexes/plans.zip", reason: "nestedArchive" },
      { path: "../../.env", reason: "unsafePath" },
    ]);
  });

  it("does not unpack a dossier twice when the job is delivered twice", async () => {
    const again = await expandArchiveFor(archiveId);
    expect(again.outcome).toBe("already");
    expect(await children()).toHaveLength(2);
  });

  it("does not open a second level: a file that came out of an archive is never opened", async () => {
    const inside = await children();
    const nested = await expandArchiveFor(inside[0]?.id as string);
    expect(nested.outcome).toBe("nested");
  });

  it("says nothing about an attachment that is not an archive", async () => {
    expect((await expandArchiveFor(plainId)).outcome).toBe("notArchive");
    // And writes no audit entry for it — 37 of 38 files in this mailbox are
    // not archives, and a trail that records a non-event about each of them is
    // a trail nobody reads.
    const entries = await db.select().from(auditEntry).where(eq(auditEntry.entityId, plainId));
    expect(entries).toHaveLength(0);
  });
});
