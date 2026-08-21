import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { party, partyAlias } from "@/db/schema/party";
import { searchParties } from "@/domain/search";

/**
 * PHASE 1's TEST, from docs/PLAN.md:
 * "TOUATGAZ is found by four spellings."
 *
 * The fixture is inserted and removed by this file. Nothing is seeded into the
 * running system — CLAUDE.md is explicit that fake companies teach people to
 * ignore what is on screen, and `@faker-js/faker` is for tests only.
 */
const CODE = "TEST-CL-TOUATGAZ";
let partyId: string;

beforeAll(async () => {
  await db.delete(party).where(eq(party.code, CODE));

  const [row] = await db
    .insert(party)
    .values({
      code: CODE,
      legalName: "GROUPEMENT TOUATGAZ",
      tradeName: "Touat Gaz",
      wilaya: "Adrar",
      docLocale: "fr",
    })
    .returning({ id: party.id });
  if (!row) throw new Error("fixture insert failed");
  partyId = row.id;

  await db.insert(partyAlias).values([
    { partyId, alias: "GTG", source: "typed" },
    { partyId, alias: "TouatGaz JV", source: "email" },
  ]);
});

afterAll(async () => {
  await db.delete(partyAlias).where(eq(partyAlias.partyId, partyId));
  await db.delete(party).where(eq(party.id, partyId));
});

describe("screen 82 — one company, many spellings", () => {
  // The four from the plan, plus the lower-case case, which is what people
  // actually type into a search box.
  const spellings = [
    ["TOUATGAZ", "the legal name as written"],
    ["Touat Gaz", "spaced — trigram, not substring"],
    ["TouatGaz JV", "an alias recorded from an email"],
    ["GTG", "an alias nothing could infer"],
    ["groupement touatgaz", "lower case, full name"],
  ] as const;

  for (const [term, why] of spellings) {
    it(`finds it by "${term}" — ${why}`, async () => {
      const hits = await searchParties(term);
      const found = hits.filter((h) => h.code === CODE);
      expect(found, `"${term}" returned nothing`).toHaveLength(1);
      expect(found[0]?.legalName).toBe("GROUPEMENT TOUATGAZ");
    });
  }

  it("puts an exact code match first", async () => {
    const hits = await searchParties(CODE);
    expect(hits[0]?.code).toBe(CODE);
    expect(hits[0]?.score).toBe(1);
  });

  it("returns nothing for a term that resembles nothing", async () => {
    const hits = await searchParties("zzzqqqxyw");
    expect(hits.filter((h) => h.code === CODE)).toHaveLength(0);
  });

  it("hides a soft-deleted company without losing it", async () => {
    await db.update(party).set({ deletedAt: new Date() }).where(eq(party.id, partyId));
    const hits = await searchParties("TOUATGAZ");
    expect(hits.filter((h) => h.code === CODE)).toHaveLength(0);
    await db.update(party).set({ deletedAt: null }).where(eq(party.id, partyId));
  });
});

describe("screen 82 — a result says why it matched", () => {
  it("names the alias when the alias is what matched", async () => {
    const hits = await searchParties("GTG");
    const found = hits.find((h) => h.code === CODE);
    expect(found?.matchedOn).toBe("alias");
    expect(found?.matchedAlias).toBe("GTG");
  });

  it("does not blame an alias when the legal name matched", async () => {
    const hits = await searchParties("GROUPEMENT");
    const found = hits.find((h) => h.code === CODE);
    expect(found?.matchedOn).toBe("name");
  });

  it("calls an exact code match a code match", async () => {
    const hits = await searchParties(CODE);
    expect(hits.find((h) => h.code === CODE)?.matchedOn).toBe("code");
  });
});
