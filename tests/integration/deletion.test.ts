import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { document } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import {
  deletedPartyNotice,
  discardParty,
  listBin,
  NotDiscardable,
  restoreParty,
} from "@/domain/deletion";
import { searchParties } from "@/domain/search";

/**
 * Screen 83 — three words that are not the same, and one that is never allowed.
 */
const PLAIN = "TEST-DEL-PLAIN";
const INVOICED = "TEST-DEL-INVOICED";
const ACTOR = "test-deleter";

let plainId: string;
let invoicedId: string;
let docId: string;

beforeAll(async () => {
  await db.delete(party).where(inArray(party.code, [PLAIN, INVOICED]));

  const [a] = await db
    .insert(party)
    .values({ code: PLAIN, legalName: "SARL Entered Twice" })
    .returning({ id: party.id });
  const [b] = await db
    .insert(party)
    .values({ code: INVOICED, legalName: "SARL Real Client" })
    .returning({ id: party.id });
  plainId = a?.id as string;
  invoicedId = b?.id as string;

  const [doc] = await db
    .insert(document)
    .values({
      kind: "invoice",
      number: "SUP/2026/0099",
      partyId: invoicedId,
      locale: "fr",
      status: "issued",
      totals: {},
    })
    .returning({ id: document.id });
  docId = doc?.id as string;
});

afterAll(async () => {
  await db.delete(document).where(eq(document.id, docId));
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  await db.delete(party).where(inArray(party.code, [PLAIN, INVOICED]));
});

describe("screen 83 — discard, restore, and what may never go", () => {
  it("refuses to discard a company that has issued a document", async () => {
    await expect(
      discardParty({ id: invoicedId, reason: "no longer a client", actorId: ACTOR }),
    ).rejects.toBeInstanceOf(NotDiscardable);

    const [still] = await db.select().from(party).where(eq(party.id, invoicedId));
    expect(still?.deletedAt, "it must not have been binned").toBeNull();
  });

  it("discards a company nobody ever invoiced, keeping the reason", async () => {
    await discardParty({ id: plainId, reason: "entered twice", actorId: ACTOR });

    const [row] = await db.select().from(party).where(eq(party.id, plainId));
    expect(row?.deletedAt).toBeTruthy();
    expect(row?.deleteReason).toBe("entered twice");
    // Soft delete only — the row is still there.
    expect(row?.legalName).toBe("SARL Entered Twice");
  });

  it("takes it out of search", async () => {
    const hits = await searchParties("Entered Twice");
    expect(hits.filter((h) => h.code === PLAIN)).toHaveLength(0);
  });

  it("puts it in the bin with days remaining", async () => {
    const bin = await listBin();
    const ours = bin.find((r) => r.code === PLAIN);
    expect(ours).toBeDefined();
    expect(ours?.reason).toBe("entered twice");
    expect(ours?.daysLeft).toBe(30);
  });

  it("never a blank 404 — the old link explains itself", async () => {
    const notice = await deletedPartyNotice(plainId);
    expect(notice?.code).toBe(PLAIN);
    expect(notice?.reason).toBe("entered twice");
    expect(notice?.daysLeft).toBe(30);
  });

  it("logs who, what and why, and the entry outlives the record", async () => {
    const entries = await db.select().from(auditEntry).where(eq(auditEntry.actorId, ACTOR));
    const discard = entries.find((e) => e.action === "discard");
    expect(discard?.reason).toBe("entered twice");
    expect(discard?.entityId).toBe(plainId);
    expect(discard?.sourceScreen).toBe("22");
  });

  it("restores it, and search finds it again", async () => {
    await restoreParty({ id: plainId, actorId: ACTOR });

    const [row] = await db.select().from(party).where(eq(party.id, plainId));
    expect(row?.deletedAt).toBeNull();
    expect(row?.deleteReason).toBeNull();

    const hits = await searchParties("Entered Twice");
    expect(hits.filter((h) => h.code === PLAIN)).toHaveLength(1);

    const entries = await db.select().from(auditEntry).where(eq(auditEntry.actorId, ACTOR));
    expect(entries.some((e) => e.action === "restore")).toBe(true);
  });
});
