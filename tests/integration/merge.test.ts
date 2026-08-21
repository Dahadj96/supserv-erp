import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry, mergeLog } from "@/db/schema/control";
import { document } from "@/db/schema/document";
import { party, partyAlias } from "@/db/schema/party";
import { mergeParties } from "@/domain/merge";
import { searchParties } from "@/domain/search";

/**
 * PHASE 1's SECOND TEST, from docs/PLAN.md:
 * "two duplicate rows merge into one without losing a document."
 *
 * Screen 84 states the rule this file exists to prove: a merge is not a delete.
 */
const KEPT = "TEST-CL-0007";
const RETIRED = "TEST-CL-0031";
const ACTOR = "test-actor";

let keptId: string;
let retiredId: string;
let documentId: string;

beforeAll(async () => {
  await db.delete(party).where(inArray(party.code, [KEPT, RETIRED]));

  const [a] = await db
    .insert(party)
    .values({
      code: KEPT,
      legalName: "GROUPEMENT TOUATGAZ (JV SONATRACH - ENI)",
      nif: "000116001234567",
      rc: "16/00-1234567 B 09",
      email: "contact@touatgaz.dz",
      address: "Zone industrielle, Adrar",
      paymentTerms: "Virement 45 jours",
      docLocale: "fr",
    })
    .returning({ id: party.id });

  const [b] = await db
    .insert(party)
    .values({
      code: RETIRED,
      legalName: "TOUATGAZ",
      rc: "16/00-1234567 B 09", // identical RC — this is why it was flagged
      email: "m.belkacem@touatgaz.dz",
      address: "Adrar",
      paymentTerms: "Virement 30 jours",
      docLocale: "fr",
    })
    .returning({ id: party.id });

  keptId = a?.id as string;
  retiredId = b?.id as string;

  await db.insert(partyAlias).values([
    { partyId: keptId, alias: "Touat Gaz", source: "typed" },
    { partyId: keptId, alias: "GTG", source: "typed" },
    { partyId: retiredId, alias: "TouatGaz JV", source: "email" },
  ]);

  // An ISSUED invoice on the record that is about to be retired. This is the
  // document that must not go missing.
  const [doc] = await db
    .insert(document)
    .values({
      kind: "invoice",
      number: "SUP/2026/0042",
      partyId: retiredId,
      locale: "fr",
      status: "issued",
      totals: { totalExcl: "1000.00", totalIncl: "1190.00" },
    })
    .returning({ id: document.id });
  documentId = doc?.id as string;
});

afterAll(async () => {
  await db.delete(document).where(eq(document.id, documentId));
  await db.delete(mergeLog).where(eq(mergeLog.keptId, keptId));
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  await db.delete(partyAlias).where(inArray(partyAlias.partyId, [keptId, retiredId]));
  await db.delete(party).where(inArray(party.code, [KEPT, RETIRED]));
});

describe("screen 84 — a merge is not a delete", () => {
  it("merges, and the invoice survives with its number", async () => {
    // The newer record is right about payment terms — it came off the last
    // signed contract. Everything else the kept record wins.
    const result = await mergeParties({
      keptId,
      retiredId,
      choices: { paymentTerms: "retired" },
      actorId: ACTOR,
    });

    expect(result.keptId).toBe(keptId);

    const [retired] = await db.select().from(party).where(eq(party.id, retiredId));
    expect(retired, "the retired row was removed — it must not be").toBeDefined();
    expect(retired?.supersededBy).toBe(keptId);
    expect(retired?.deletedAt, "a merge is not a delete").toBeNull();

    const [doc] = await db.select().from(document).where(eq(document.id, documentId));
    expect(doc, "the invoice vanished").toBeDefined();
    expect(doc?.number).toBe("SUP/2026/0042");
    // LAW 5 — an issued document is immutable, so it still points where it did.
    expect(doc?.partyId).toBe(retiredId);
  });

  it("takes the field the person chose, and leaves the rest", async () => {
    const [kept] = await db.select().from(party).where(eq(party.id, keptId));
    expect(kept?.paymentTerms).toBe("Virement 30 jours");
    expect(kept?.address).toBe("Zone industrielle, Adrar");
    expect(kept?.nif).toBe("000116001234567");
  });

  it("adds both alias lists together — aliases are never a choice", async () => {
    const aliases = (
      await db
        .select({ alias: partyAlias.alias })
        .from(partyAlias)
        .where(eq(partyAlias.partyId, keptId))
    ).map((r) => r.alias);

    expect(aliases).toEqual(expect.arrayContaining(["Touat Gaz", "GTG", "TouatGaz JV"]));
    // and the retired reference, so it stays searchable forever
    expect(aliases).toEqual(expect.arrayContaining([RETIRED, "TOUATGAZ"]));
  });

  it("leaves one row where there were two", async () => {
    const hits = await searchParties("TOUATGAZ");
    const ours = hits.filter((h) => [KEPT, RETIRED].includes(h.code));
    expect(ours).toHaveLength(1);
    expect(ours[0]?.code).toBe(KEPT);
  });

  it("still finds the retired reference, and lands on the survivor", async () => {
    const hits = await searchParties(RETIRED);
    expect(hits[0]?.code).toBe(KEPT);
    expect(hits[0]?.matchedOn).toBe("alias");
  });

  it("logs who, when, and every field chosen", async () => {
    const [log] = await db.select().from(mergeLog).where(eq(mergeLog.keptId, keptId));
    expect(log?.retiredId).toBe(retiredId);
    expect(log?.mergedBy).toBe(ACTOR);
    expect(log?.fieldChoices).toEqual({ paymentTerms: "retired" });
    expect(log?.reversibleUntil, "reversible for 30 days").toBeTruthy();

    const [entry] = await db.select().from(auditEntry).where(eq(auditEntry.actorId, ACTOR));
    expect(entry?.action).toBe("merge");
    expect(entry?.sourceScreen).toBe("84");
  });

  it("refuses to merge a record that was already merged away", async () => {
    await expect(mergeParties({ keptId, retiredId, choices: {}, actorId: ACTOR })).rejects.toThrow(
      /already been merged/,
    );
  });

  it("refuses to merge a company into itself", async () => {
    await expect(
      mergeParties({ keptId, retiredId: keptId, choices: {}, actorId: ACTOR }),
    ).rejects.toThrow(/into itself/);
  });
});
