import { eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { priceQuote } from "@/db/schema/deal";
import { party, partyRole } from "@/db/schema/party";
import { priceHistory } from "@/domain/deal/price-history";
import { capturePrice, PriceRefused, recentCounterPrices } from "@/domain/deal/price-store";

/**
 * Screen 74 on a phone: a man at a counter in Adrar, no enquiry open.
 *
 * The point of the screen is the last test in this file — a price written down
 * in a shop in September has to answer "what did this cost last time" on an
 * offer built in November, with nobody having filed it anywhere.
 */
const ACTOR = "test-counter-price-actor";
const SHOP = "ETS CHERGUI (TEST COUNTER)";
const THING = "Coude galvanisé 90° DN80 — série CTR9";

const created: string[] = [];

afterAll(async () => {
  if (created.length) await db.delete(priceQuote).where(inArray(priceQuote.id, created));
  const shops = await db
    .select({ id: party.id })
    .from(party)
    .where(like(party.legalName, "% (TEST COUNTER)"));
  const ids = shops.map((s) => s.id);
  if (ids.length > 0) {
    await db.delete(priceQuote).where(inArray(priceQuote.partyId, ids));
    await db.delete(partyRole).where(inArray(partyRole.partyId, ids));
    await db.delete(party).where(inArray(party.id, ids));
  }
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
});

describe("a price at the counter", () => {
  it("needs a subject and a real number, and says which is missing", async () => {
    await expect(
      capturePrice({
        designation: "   ",
        supplierName: SHOP,
        price: "100",
        isExclVat: false,
        isVerbal: true,
        actorId: ACTOR,
      }),
    ).rejects.toMatchObject({ reason: "noSubject" });

    for (const price of ["0", "-5", "gratuit", ""]) {
      await expect(
        capturePrice({
          designation: THING,
          supplierName: SHOP,
          price,
          isExclVat: false,
          isVerbal: true,
          actorId: ACTOR,
        }),
      ).rejects.toBeInstanceOf(PriceRefused);
    }

    await expect(
      capturePrice({
        designation: THING,
        supplierName: "  ",
        price: "100",
        isExclVat: false,
        isVerbal: true,
        actorId: ACTOR,
      }),
    ).rejects.toMatchObject({ reason: "supplierRequired" });
  });

  it("belongs to no enquiry, keeps the wording as its subject, and writes the shop down", async () => {
    const id = await capturePrice({
      designation: THING,
      supplierName: SHOP,
      // Typed on a phone: a space for thousands and a comma for the decimal.
      price: "2 450,50",
      isExclVat: false,
      isVerbal: true,
      capturedPlace: "Ets Chergui, Adrar",
      capturedFrom: "M. Chergui",
      actorId: ACTOR,
    });
    created.push(id);

    const [row] = await db.select().from(priceQuote).where(eq(priceQuote.id, id));
    expect(row).toMatchObject({
      dealId: null,
      dealLineId: null,
      itemId: null,
      designation: THING,
      source: "shop_visit",
      price: "2450.5000",
      isExclVat: false,
      isVerbal: true,
      capturedPlace: "Ets Chergui, Adrar",
      capturedFrom: "M. Chergui",
    });

    // The shop nobody had written down until this moment is now a supplier
    // with a name and nothing else.
    const [shop] = await db
      .select()
      .from(party)
      .where(eq(party.id, row?.partyId as string));
    expect(shop?.legalName).toBe(SHOP);
    expect(shop?.code).toMatch(/^SU-\d{4}$/);
    const [role] = await db
      .select()
      .from(partyRole)
      .where(eq(partyRole.partyId, shop?.id as string));
    expect(role?.role).toBe("supplier");
  });

  it("finds the same shop the second time rather than writing it down twice", async () => {
    const id = await capturePrice({
      designation: "Té égal DN80 — série CTR9",
      supplierName: SHOP,
      price: "1800",
      isExclVat: true,
      isVerbal: false,
      actorId: ACTOR,
    });
    created.push(id);

    const shops = await db
      .select({ id: party.id })
      .from(party)
      .where(like(party.legalName, "% (TEST COUNTER)"));
    expect(shops).toHaveLength(1);
  });

  it("shows up in what you wrote down, newest first", async () => {
    const recent = await recentCounterPrices(50);
    const mine = recent.filter((r) => r.supplier === SHOP);
    expect(mine.map((r) => r.designation)).toEqual(["Té égal DN80 — série CTR9", THING]);
    expect(mine[1]).toMatchObject({ isVerbal: true, isExclVat: false });
  });

  it("answers the offer builder months later, which is the whole point", async () => {
    const h = await priceHistory(THING, { limit: 50 });
    expect(h.bought.map((b) => b.quoteId)).toContain(created[0]);
    const found = h.bought.find((b) => b.quoteId === created[0]);
    expect(found).toMatchObject({ price: "2450.5000", isVerbal: true, source: "shop_visit" });
    expect(found?.supplier).toBe(SHOP);
  });
});
