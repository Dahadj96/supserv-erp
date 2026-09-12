import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal } from "@/db/schema/deal";
import { document } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import { bulkDiscard, bulkDiscardPreview, listBin, restoreDeal } from "@/domain/deletion";

/**
 * Bulk delete — and the one property that makes it safe enough to exist.
 *
 * `bulk-bar.tsx` refused delete for a year because a discard could not be
 * undone. V1, V2 and V3 made that false, so the button arrives — but only with
 * this: a refusal is NEVER SILENT. A bulk action that quietly skips eleven of
 * your fifty rows is worse than no bulk action, and these tests are the thing
 * standing between this feature and that.
 */
const CLIENT = "TEST-BULK-CLIENT";
const ACTOR = "test-bulker";
const REFS = ["TEST-BULK-A", "TEST-BULK-B", "TEST-BULK-C"];

let clientId: string;
let ids: string[] = [];
let invoicedDealId: string;
let invoiceId: string;

beforeAll(async () => {
  await db.delete(deal).where(inArray(deal.ref, REFS));
  await db.delete(party).where(eq(party.code, CLIENT));

  const [client] = await db
    .insert(party)
    .values({ code: CLIENT, legalName: "SARL Bulk" })
    .returning({ id: party.id });
  clientId = client?.id as string;

  const made = await db
    .insert(deal)
    .values(
      REFS.map((ref) => ({
        ref,
        partyId: clientId,
        subject: `Bulk ${ref}`,
        receivedAt: new Date(),
      })),
    )
    .returning({ id: deal.id, ref: deal.ref });
  ids = made.map((d) => d.id);
  invoicedDealId = made.find((d) => d.ref === "TEST-BULK-C")?.id as string;

  // One of the three has issued paper and must never go, however it is asked.
  const [inv] = await db
    .insert(document)
    .values({
      kind: "invoice",
      number: "SUP/2026/7777",
      partyId: clientId,
      dealId: invoicedDealId,
      locale: "fr",
      status: "issued",
      totals: {},
    })
    .returning({ id: document.id });
  invoiceId = inv?.id as string;
});

afterAll(async () => {
  await db.delete(document).where(eq(document.id, invoiceId));
  await db.delete(deal).where(inArray(deal.ref, REFS));
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  await db.delete(party).where(eq(party.code, CLIENT));
});

describe("bulk delete — the refusal is never silent", () => {
  it("says which rows cannot go BEFORE anything is written", async () => {
    const seen = await bulkDiscardPreview({ kind: "deal", ids });

    expect(seen.canGo).toBe(2);
    expect(seen.refused).toHaveLength(1);
    // Named, not counted: "1 was skipped" leaves somebody comparing two lists.
    expect(seen.refused[0]?.label).toBe("TEST-BULK-C");
    expect(seen.refused[0]?.reason).toBe("hasIssuedDocuments");

    // And nothing has been written by asking.
    const rows = await db.select().from(deal).where(inArray(deal.id, ids));
    expect(rows.every((r) => r.deletedAt === null)).toBe(true);
  });

  it("bins what it can and names what it could not, with the same answer", async () => {
    const done = await bulkDiscard({
      kind: "deal",
      ids,
      reason: "ticked the wrong filter",
      actorId: ACTOR,
    });

    expect(done.binned).toBe(2);
    expect(done.refused).toHaveLength(1);
    expect(done.refused[0]?.label).toBe("TEST-BULK-C");
    expect(done.refused[0]?.reason).toBe("hasIssuedDocuments");
  });

  it("leaves the invoiced enquiry exactly where it was", async () => {
    const [row] = await db.select().from(deal).where(eq(deal.id, invoicedDealId));
    expect(row?.deletedAt).toBeNull();
  });

  it("puts every one it took in the bin, each with the reason given", async () => {
    const bin = await listBin();
    const ours = bin.filter((r) => r.kind === "deal" && ids.includes(r.id));
    expect(ours).toHaveLength(2);
    for (const row of ours) expect(row.reason).toBe("ticked the wrong filter");
  });

  it("writes a separate audit entry per record, not one for the batch", async () => {
    const entries = await db.select().from(auditEntry).where(eq(auditEntry.actorId, ACTOR));
    const discards = entries.filter((e) => e.entity === "deal" && e.action === "discard");
    expect(discards).toHaveLength(2);
    // Each one came from the list, and each carries its own reason.
    for (const e of discards) expect(e.reason).toBe("ticked the wrong filter");
  });

  it("restores one of them on its own, as if it had been binned alone", async () => {
    const restorable = ids.filter((id) => id !== invoicedDealId);
    await restoreDeal({ id: restorable[0] as string, actorId: ACTOR });

    const [back] = await db
      .select()
      .from(deal)
      .where(eq(deal.id, restorable[0] as string));
    expect(back?.deletedAt).toBeNull();

    const [stillGone] = await db
      .select()
      .from(deal)
      .where(eq(deal.id, restorable[1] as string));
    expect(stillGone?.deletedAt, "the other one is untouched").toBeTruthy();
  });

  it("asks the same question of an empty selection without falling over", async () => {
    const seen = await bulkDiscardPreview({ kind: "deal", ids: [] });
    expect(seen).toEqual({ canGo: 0, refused: [] });
  });
});
