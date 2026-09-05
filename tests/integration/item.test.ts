import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { item, itemAlias, itemMedia } from "@/db/schema/item";
import { fileByIndexId } from "@/domain/files";
import { createItem, itemAliases, matchItem, rememberMatch } from "@/domain/item";
import {
  addItemMedia,
  itemTechnicalFile,
  MAX_MEDIA_BYTES,
  MediaRefused,
} from "@/domain/item-technical";
import { storageFor } from "@/storage";

/**
 * Screen 75 — "Remembered for next time".
 *
 * "Once you have matched a client wording to a supplier article, the system
 * recognises it next time — including on a different enquiry from a different
 * client." The last clause is the whole test: the memory belongs to the item,
 * not to the enquiry that created it.
 */
const ACTOR = "test-item-actor";
let ampId: string;
let cableId: string;
const madeIds: string[] = [];
const mediaIds: string[] = [];

beforeAll(async () => {
  const amp = await createItem({
    designation: "Amplificateur 120W 4 zones",
    kind: "good",
    brand: "TOA",
  });
  const cable = await createItem({
    designation: "Câble HP 2×1,5 mm²",
    kind: "good",
    isGeneric: true,
  });
  ampId = amp.id;
  cableId = cable.id;
  madeIds.push(ampId, cableId);
});

afterAll(async () => {
  await db.delete(itemAlias).where(inArray(itemAlias.itemId, madeIds));
  await db.delete(itemMedia).where(inArray(itemMedia.itemId, madeIds));
  await db.delete(item).where(inArray(item.id, madeIds));
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
});

describe("the item remembers every name it has been given", () => {
  it("allocates a reference of its own", async () => {
    const [row] = await db
      .select()
      .from(item)
      .where(inArray(item.id, [ampId]));
    expect(row?.code).toMatch(/^ITM-\d{4}$/);
  });

  it("finds an item by its own designation, accents and all", async () => {
    const hits = await matchItem("cable hp 2x1,5 mm2");
    expect(hits.map((h) => h.itemId)).toContain(cableId);
  });

  it("does not yet know the supplier's wording", async () => {
    const hits = await matchItem("Ampli mélangeur 120W 4Z + BT");
    expect(hits.map((h) => h.itemId)).not.toContain(ampId);
  });

  it("recognises it after the match is remembered", async () => {
    await rememberMatch({
      itemId: ampId,
      clientWording: "Amplificateur 120W 4 zones",
      supplierWording: "Ampli mélangeur 120W 4Z + BT",
    });

    const hits = await matchItem("Ampli mélangeur 120W 4Z + BT");
    const hit = hits.find((h) => h.itemId === ampId);
    expect(hit, "the supplier's wording now finds the item").toBeDefined();
    expect(hit?.matchedOn).toBe("alias");
    expect(hit?.matchedAlias).toBe("Ampli mélangeur 120W 4Z + BT");
  });

  it("keeps whose word each one is", async () => {
    const aliases = await itemAliases(ampId);
    const bySource = Object.fromEntries(aliases.map((a) => [a.source, a.alias]));
    expect(bySource.client).toBe("Amplificateur 120W 4 zones");
    expect(bySource.supplier).toBe("Ampli mélangeur 120W 4Z + BT");
  });

  it("remembers across enquiries — a different client, the same words", async () => {
    // Nothing about the memory is scoped to a deal, so a second enquiry that
    // has never been seen before still lands on the item.
    const hits = await matchItem("ampli melangeur 120w 4z + bt");
    expect(hits.map((h) => h.itemId)).toContain(ampId);
  });

  it("does not match two different products", async () => {
    const hits = await matchItem("Disjoncteur différentiel 30mA");
    expect(hits.map((h) => h.itemId)).not.toContain(ampId);
    expect(hits.map((h) => h.itemId)).not.toContain(cableId);
  });

  it("refuses an item with no designation", async () => {
    await expect(createItem({ designation: " ", kind: "good" })).rejects.toThrow(
      /designationRequired/,
    );
  });

  it("leaves no gap in the reference series", async () => {
    const rows = await db.select({ code: item.code }).from(item).where(like(item.code, "ITM-%"));
    const numbers = rows.map((r) => Number(r.code.slice(4))).sort((a, b) => a - b);
    expect(new Set(numbers).size, "two items took the same reference").toBe(numbers.length);
  });
});

/**
 * The technical file — screen 77.
 *
 * `item_media` was read in three places and inserted nowhere in the
 * application: the table on screen 77 was always empty, screen 78's "datasheet
 * held" was false for every item in the catalogue for ever, and a tender asking
 * for a fiche technique had nowhere to keep the answer. Its `file_id` pointed
 * at a table `src/domain/files/index.ts` says will never exist.
 */
describe("a datasheet attached to an item", () => {
  const pdf = Buffer.from("%PDF-1.4\nnot really a pdf, but bytes are bytes\n");

  it("says what it is and where it came from, and neither is guessed", async () => {
    const id = await addItemMedia({
      itemId: ampId,
      filename: "TOA A-2120 fiche technique.pdf",
      contentType: "application/pdf",
      bytes: pdf,
      mediaKind: "datasheet",
      provenance: "manufacturer",
      capturedAtPlace: "TOA, par e-mail du 12/06",
      actorId: ACTOR,
    });
    mediaIds.push(id);

    const file = await itemTechnicalFile(ampId);
    const row = file?.media.find((m) => m.id === id);
    expect(row?.mediaKind).toBe("datasheet");
    expect(row?.provenance).toBe("manufacturer");
    expect(row?.filename).toBe("TOA A-2120 fiche technique.pdf");
    expect(row?.sizeBytes).toBe(pdf.length);

    // The badge on screen 78 that was false for every item in the catalogue.
    expect(file?.hasDatasheet).toBe(true);
  });

  it("can be opened — the row carries the id the files route takes", async () => {
    const file = await itemTechnicalFile(ampId);
    const row = file?.media[0];
    expect(row?.fileId).toMatch(/^item:[0-9a-f-]{36}$/);

    // And the same id resolves through the files index, which is what
    // `/api/files/[id]` looks it up with.
    const found = await fileByIndexId(row?.fileId as string);
    expect(found?.kind).toBe("item");
    expect(found?.state).toBe("stored");
    expect(found?.belongsTo.href).toBe(`/items/${ampId}/technical`);
  });

  it("puts the bytes where the row says they are", async () => {
    const [row] = await db
      .select({ path: itemMedia.storagePath })
      .from(itemMedia)
      .where(inArray(itemMedia.itemId, [ampId]));
    // Built from the item's code and never from the upload's own name: a
    // filename is the one string on an upload that an attacker chooses.
    expect(row?.path).toMatch(/^items\/ITM-\d{4}\/\d+-TOA_A-2120_fiche_technique.pdf$/);
    expect((await storageFor("working").get(row?.path as string)).equals(pdf)).toBe(true);
  });

  it("refuses a kind or a provenance nobody declared", async () => {
    const base = {
      itemId: ampId,
      filename: "x.pdf",
      contentType: "application/pdf",
      bytes: pdf,
      provenance: "manufacturer",
      actorId: ACTOR,
    };
    await expect(addItemMedia({ ...base, mediaKind: "invoice" })).rejects.toMatchObject({
      reason: "badKind",
    });
    await expect(
      addItemMedia({ ...base, mediaKind: "datasheet", provenance: "somewhere" }),
    ).rejects.toMatchObject({ reason: "badProvenance" });
  });

  it("refuses an empty file and one over ten megabytes", async () => {
    const base = {
      itemId: ampId,
      filename: "x.pdf",
      contentType: "application/pdf",
      mediaKind: "datasheet",
      provenance: "manufacturer",
      actorId: ACTOR,
    };
    await expect(addItemMedia({ ...base, bytes: Buffer.alloc(0) })).rejects.toMatchObject({
      reason: "empty",
    });
    await expect(
      addItemMedia({ ...base, bytes: Buffer.alloc(MAX_MEDIA_BYTES + 1) }),
    ).rejects.toMatchObject({ reason: "tooBig" });
  });

  it("refuses an item that does not exist", async () => {
    await expect(
      addItemMedia({
        itemId: "00000000-0000-4000-8000-000000000000",
        filename: "x.pdf",
        contentType: "application/pdf",
        bytes: pdf,
        mediaKind: "datasheet",
        provenance: "manufacturer",
        actorId: ACTOR,
      }),
    ).rejects.toBeInstanceOf(MediaRefused);
  });
});
