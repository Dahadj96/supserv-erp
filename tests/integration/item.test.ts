import { inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { item, itemAlias } from "@/db/schema/item";
import { createItem, itemAliases, matchItem, rememberMatch } from "@/domain/item";

/**
 * Screen 75 — "Remembered for next time".
 *
 * "Once you have matched a client wording to a supplier article, the system
 * recognises it next time — including on a different enquiry from a different
 * client." The last clause is the whole test: the memory belongs to the item,
 * not to the enquiry that created it.
 */
let ampId: string;
let cableId: string;
const madeIds: string[] = [];

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
  await db.delete(item).where(inArray(item.id, madeIds));
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
