import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal } from "@/db/schema/deal";
import { document } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import {
  deletedPartyNotice,
  discardDeal,
  discardDocument,
  discardParty,
  listBin,
  NotDiscardable,
  restoreDeal,
  restoreDocument,
  restoreParty,
} from "@/domain/deletion";
import { searchParties } from "@/domain/search";

/**
 * Screen 83 — three words that are not the same, and one that is never allowed.
 */
const PLAIN = "TEST-DEL-PLAIN";
const INVOICED = "TEST-DEL-INVOICED";
const ENQUIRY = "TEST-DEL-ENQ";
const ACTOR = "test-deleter";

let plainId: string;
let invoicedId: string;
let docId: string;
let dealId: string;
let draftId: string;

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

  // The other two kinds the bin holds: an enquiry that should never have
  // existed, and the draft nobody outside the company ever saw.
  await db.delete(deal).where(eq(deal.ref, ENQUIRY));
  const [enq] = await db
    .insert(deal)
    .values({
      ref: ENQUIRY,
      partyId: plainId,
      subject: "Typed while learning the screen",
      receivedAt: new Date(),
    })
    .returning({ id: deal.id });
  dealId = enq?.id as string;

  const [draft] = await db
    .insert(document)
    .values({ kind: "quotation", partyId: plainId, locale: "fr", status: "draft", totals: {} })
    .returning({ id: document.id });
  draftId = draft?.id as string;
});

afterAll(async () => {
  await db.delete(document).where(inArray(document.id, [docId, draftId]));
  await db.delete(deal).where(eq(deal.ref, ENQUIRY));
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

/**
 * Screen 83 holds three kinds of record, and the reason it must is that a
 * person opening the bin has lost something and does not remember which kind
 * it was. A bin that lists only companies is a bin that answers "no" to two
 * thirds of the question it exists for.
 */
describe("screen 83 — the bin holds companies, enquiries and drafts", () => {
  it("lists all three kinds, each saying what it is", async () => {
    await discardParty({ id: plainId, reason: "entered twice", actorId: ACTOR });
    await discardDeal({ id: dealId, reason: "somebody else's enquiry", actorId: ACTOR });
    await discardDocument({ id: draftId, reason: "wrong client", actorId: ACTOR });

    const bin = await listBin();

    const company = bin.find((r) => r.kind === "company" && r.id === plainId);
    expect(company?.what).toBe("SARL Entered Twice");
    expect(company?.code).toBe(PLAIN);

    const enquiry = bin.find((r) => r.kind === "deal" && r.id === dealId);
    expect(enquiry?.what).toBe("Typed while learning the screen");
    expect(enquiry?.code).toBe(ENQUIRY);
    expect(enquiry?.reason).toBe("somebody else's enquiry");

    // A draft is in the bin precisely because it never took a number, so the
    // kind is what identifies it and the code is empty on purpose.
    const draft = bin.find((r) => r.kind === "document" && r.id === draftId);
    expect(draft?.what).toBe("quotation");
    expect(draft?.code).toBe("");

    for (const row of [company, enquiry, draft]) expect(row?.daysLeft).toBe(30);
  });

  it("orders across the whole set, not kind by kind", async () => {
    const bin = await listBin();
    expect(bin.filter((r) => [plainId, dealId, draftId].includes(r.id))).toHaveLength(3);

    // Newest first, whatever kind it is. Three lists sorted separately and
    // concatenated would put the company binned first at the top, because the
    // three above went in company, then enquiry, then draft.
    const times = bin.map((r) => r.deletedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("takes each one back out again", async () => {
    await restoreParty({ id: plainId, actorId: ACTOR });
    await restoreDeal({ id: dealId, actorId: ACTOR });
    await restoreDocument({ id: draftId, actorId: ACTOR });

    const bin = await listBin();
    expect(bin.filter((r) => [plainId, dealId, draftId].includes(r.id))).toHaveLength(0);
  });
});
