import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { document } from "@/db/schema/document";
import { party, partyAlias } from "@/db/schema/party";
import { defaultChoices, mergePreview } from "@/domain/merge-preview";

/**
 * Screen 84, the half that runs BEFORE anything is decided.
 *
 * What this file is really testing is honesty: that the screen shows the
 * signals it actually found — including the ones it did not — and counts that
 * come from the database rather than from an assumption about what is attached.
 */
const A = "TEST-PRV-KEPT";
const B = "TEST-PRV-RETIRED";
const C = "TEST-PRV-ALREADY-MERGED";

let aId: string;
let bId: string;
let cId: string;

beforeAll(async () => {
  await db.delete(party).where(inArray(party.code, [A, B, C]));

  const [a] = await db
    .insert(party)
    .values({
      code: A,
      legalName: "ENTREPRISE DES TRAVAUX DU SUD",
      nif: "000116009876543",
      rc: "01/00-9876543 B 11",
      email: "contact@ets-sud.dz",
      address: "Route de Reggane, Adrar",
      paymentTerms: "Virement 45 jours",
      createdAt: new Date("2024-01-10T09:00:00Z"),
    })
    .returning({ id: party.id });

  const [b] = await db
    .insert(party)
    .values({
      code: B,
      legalName: "ETS DU SUD",
      // No NIF, but a NIS the kept record is missing — one field each way.
      nis: "000116009876543001",
      rc: "01/00-9876543 B 11", // identical: the strongest signal there is
      email: "k.mansouri@ets-sud.dz", // same domain, different mailbox
      phone: "049 96 12 34", // the kept record has none, so this is not a match
      paymentTerms: "Virement 30 jours",
      createdAt: new Date("2025-06-02T09:00:00Z"), // the newer record
    })
    .returning({ id: party.id });

  aId = a?.id as string;
  bId = b?.id as string;

  const [c] = await db
    .insert(party)
    .values({ code: C, legalName: "ETS SUD (ancien)", supersededBy: aId })
    .returning({ id: party.id });
  cId = c?.id as string;

  await db.insert(partyAlias).values([
    { partyId: aId, alias: "ETS Sud", source: "typed" },
    { partyId: aId, alias: "ETS DU SUD", source: "typed" },
    { partyId: bId, alias: "ETS Sud", source: "email" }, // already on the kept side
    { partyId: bId, alias: "Travaux Sud", source: "email" },
  ]);

  await db.insert(document).values([
    { kind: "invoice", partyId: aId, locale: "fr", status: "draft", totals: {} },
    { kind: "invoice", partyId: aId, locale: "fr", status: "draft", totals: {} },
    { kind: "invoice", partyId: bId, locale: "fr", status: "draft", totals: {} },
    { kind: "offer", partyId: bId, locale: "fr", status: "draft", totals: {} },
  ]);
});

afterAll(async () => {
  await db.delete(document).where(inArray(document.partyId, [aId, bId]));
  await db.delete(partyAlias).where(inArray(partyAlias.partyId, [aId, bId]));
  await db.delete(party).where(inArray(party.code, [A, B, C]));
});

describe("screen 84 — before anything is decided", () => {
  it("reports the signals it found, and the ones it did not", async () => {
    const preview = await mergePreview(aId, bId);
    const by = Object.fromEntries((preview?.signals ?? []).map((s) => [s.key, s]));

    expect(by.rc?.matched, "identical RC is why this pair was flagged").toBe(true);
    expect(by.emailDomain?.matched).toBe(true);
    expect(by.emailDomain?.detail, "the screen shows which domain").toBe("ets-sud.dz");

    // Only one record has a NIF and only one has a phone. Neither is a match,
    // and the screen says so rather than staying silent.
    expect(by.nif?.matched).toBe(false);
    expect(by.phone?.matched).toBe(false);
  });

  it("counts what is attached, by kind and by side", async () => {
    const preview = await mergePreview(aId, bId);
    const by = Object.fromEntries((preview?.moves ?? []).map((m) => [m.key, m]));

    expect(by["document.invoice"]).toMatchObject({ kept: 2, retired: 1, after: 3 });
    expect(by["document.offer"]).toMatchObject({ kept: 0, retired: 1, after: 1 });
  });

  it("shows no row for a kind neither record has", async () => {
    const preview = await mergePreview(aId, bId);
    const keys = (preview?.moves ?? []).map((m) => m.key);
    // A zero row would be a claim about a part of the system that does not
    // exist yet. Rows arrive as their tables do.
    expect(keys).not.toContain("document.delivery");
  });

  it("treats aliases as a union, never a sum", async () => {
    const preview = await mergePreview(aId, bId);
    // ETS Sud is on both sides and counts once; the retired code and legal name
    // join the list so the old reference stays searchable.
    expect(preview?.kept.aliases).toHaveLength(2);
    expect(preview?.retired.aliases).toHaveLength(2);
    expect(preview?.aliasesAfter).toBe(4);
  });

  it("proposes the kept record, except where that would throw away the only value", async () => {
    const preview = await mergePreview(aId, bId);
    if (!preview) throw new Error("no preview");
    const choices = defaultChoices(preview.kept, preview.retired);

    expect(choices.legalName).toBe("kept");
    expect(choices.address, "only the kept record has one").toBe("kept");
    expect(choices.nif, "only the kept record has one").toBe("kept");
    expect(choices.nis, "only the retired record has one").toBe("retired");
    expect(choices.phone, "only the retired record has one").toBe("retired");
  });

  it("proposes the newer record for payment terms", async () => {
    const preview = await mergePreview(aId, bId);
    if (!preview) throw new Error("no preview");
    // "the newer record is right — it came off the last signed contract"
    expect(defaultChoices(preview.kept, preview.retired).paymentTerms).toBe("retired");
  });

  it("refuses a record that has already been merged away", async () => {
    expect(await mergePreview(aId, cId)).toBeNull();
    expect(await mergePreview(aId, aId), "a company cannot merge into itself").toBeNull();
  });

  it("refuses a company that does not exist", async () => {
    const [gone] = await db.select({ id: party.id }).from(party).where(eq(party.code, C));
    expect(gone).toBeDefined();
    expect(await mergePreview(aId, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
