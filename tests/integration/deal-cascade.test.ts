import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine } from "@/db/schema/deal";
import { document } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import { sourcingRequest } from "@/db/schema/sourcing";
import { listSourcingRequests } from "@/domain/deal/sourcing-list";
import {
  DealNotDiscardable,
  dealDiscardEffect,
  discardDeal,
  listBin,
  purgeBlockedBy,
  purgeFromBin,
  restoreDeal,
} from "@/domain/deletion";
import { listOffers } from "@/domain/offer/store";

/**
 * V1, V2 and V3 — what a discard takes with it, and what a purge refuses.
 *
 * The bug this pins down: `discardDeal` wrote ONE row. The foreign keys look
 * like they would take care of the rest — `deal_line` is ON DELETE cascade and
 * `sourcing_request.deal_id` is too — and both fire only on a HARD delete,
 * which this system never does. So an enquiry left every list while its
 * unissued proforma stayed on /offers pointing at a deal nobody could open,
 * and that draft was not in the bin either, because the bin lists a document
 * only when the DOCUMENT's own deleted_at is set.
 */
const CLIENT = "TEST-CASCADE-CLIENT";
const ENQUIRY = "TEST-CASCADE-ENQ";
const ISSUED_ENQUIRY = "TEST-CASCADE-ISSUED";
const ACTOR = "test-cascader";

let clientId: string;
let dealId: string;
let draftId: string;
let issuedDealId: string;
let issuedDocId: string;

beforeAll(async () => {
  await db.delete(deal).where(inArray(deal.ref, [ENQUIRY, ISSUED_ENQUIRY]));
  await db.delete(party).where(eq(party.code, CLIENT));

  const [client] = await db
    .insert(party)
    .values({ code: CLIENT, legalName: "SARL Cascade" })
    .returning({ id: party.id });
  clientId = client?.id as string;

  const [enq] = await db
    .insert(deal)
    .values({
      ref: ENQUIRY,
      partyId: clientId,
      subject: "Vannes DN80 — the whole enquiry",
      receivedAt: new Date(),
    })
    .returning({ id: deal.id });
  dealId = enq?.id as string;

  await db.insert(dealLine).values([
    { dealId, position: 1, designation: "Vanne papillon DN80", qty: "6" },
    { dealId, position: 2, designation: "Joint plat DN80", qty: "12" },
  ]);

  await db.insert(sourcingRequest).values({
    ref: "TEST-SR-CASCADE",
    dealId,
    subject: "Prix vannes DN80",
  });

  const [draft] = await db
    .insert(document)
    .values({
      kind: "proforma",
      partyId: clientId,
      dealId,
      locale: "fr",
      status: "draft",
      totals: {},
    })
    .returning({ id: document.id });
  draftId = draft?.id as string;

  // The other enquiry: one that issued paper, and can therefore never be binned.
  const [issuedEnq] = await db
    .insert(deal)
    .values({
      ref: ISSUED_ENQUIRY,
      partyId: clientId,
      subject: "Already invoiced",
      receivedAt: new Date(),
    })
    .returning({ id: deal.id });
  issuedDealId = issuedEnq?.id as string;

  const [issuedDoc] = await db
    .insert(document)
    .values({
      kind: "invoice",
      number: "SUP/2026/9001",
      partyId: clientId,
      dealId: issuedDealId,
      locale: "fr",
      status: "issued",
      totals: {},
    })
    .returning({ id: document.id });
  issuedDocId = issuedDoc?.id as string;
});

afterAll(async () => {
  await db.delete(document).where(inArray(document.id, [draftId, issuedDocId]));
  await db.delete(sourcingRequest).where(eq(sourcingRequest.ref, "TEST-SR-CASCADE"));
  await db.delete(deal).where(inArray(deal.ref, [ENQUIRY, ISSUED_ENQUIRY]));
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  await db.delete(party).where(eq(party.code, CLIENT));
});

describe("V1 — discarding an enquiry takes its work with it", () => {
  it("counts what will go, before anybody presses the button", async () => {
    const effect = await dealDiscardEffect(dealId);
    expect(effect.lines).toBe(2);
    expect(effect.sourcingRequests).toBe(1);
    expect(effect.drafts.map((d) => d.id)).toEqual([draftId]);
    expect(effect.issued).toEqual([]);
  });

  it("refuses an enquiry that issued paper, and NAMES the document", async () => {
    const rejected = await discardDeal({
      id: issuedDealId,
      reason: "tidying up",
      actorId: ACTOR,
    }).catch((e: unknown) => e);

    expect(rejected).toBeInstanceOf(DealNotDiscardable);
    // The point of V1's refusal: "1 issued document" is a sentence somebody
    // then has to go and investigate. This one can be acted on.
    expect((rejected as DealNotDiscardable).documents).toEqual([
      { kind: "invoice", number: "SUP/2026/9001" },
    ]);

    const [still] = await db.select().from(deal).where(eq(deal.id, issuedDealId));
    expect(still?.deletedAt, "nothing may have been binned").toBeNull();
  });

  it("bins the enquiry AND its unissued draft, in one act", async () => {
    await discardDeal({ id: dealId, reason: "somebody else's enquiry", actorId: ACTOR });

    const [binnedDeal] = await db.select().from(deal).where(eq(deal.id, dealId));
    const [binnedDraft] = await db.select().from(document).where(eq(document.id, draftId));

    expect(binnedDeal?.deletedAt).toBeTruthy();
    expect(binnedDraft?.deletedAt, "the draft used to stay live").toBeTruthy();
    // One instant for the whole act — that is what lets restore put back
    // exactly this, and not a draft somebody binned separately on Tuesday.
    expect(binnedDraft?.deletedAt?.getTime()).toBe(binnedDeal?.deletedAt?.getTime());
  });

  it("takes the draft off the offers list", async () => {
    const offers = await listOffers({ limit: 500 });
    expect(offers.filter((o) => o.id === draftId)).toHaveLength(0);
  });

  it("takes the supplier request off the sourcing list", async () => {
    const requests = await listSourcingRequests(500);
    expect(requests.filter((r) => r.dealId === dealId)).toHaveLength(0);
  });

  it("puts the draft in the bin, where it can be found", async () => {
    const bin = await listBin();
    expect(bin.some((r) => r.kind === "deal" && r.id === dealId)).toBe(true);
    expect(bin.some((r) => r.kind === "document" && r.id === draftId)).toBe(true);
  });

  it("writes an audit entry for the draft as well as the enquiry", async () => {
    const entries = await db
      .select()
      .from(auditEntry)
      .where(and(eq(auditEntry.actorId, ACTOR), eq(auditEntry.action, "discard")));

    expect(entries.some((e) => e.entity === "deal" && e.entityId === dealId)).toBe(true);
    const forDraft = entries.find((e) => e.entity === "document" && e.entityId === draftId);
    expect(forDraft, "restore has to be able to find it").toBeDefined();
    expect((forDraft?.after as { withDeal?: string })?.withDeal).toBe(ENQUIRY);
  });

  it("brings all of it back", async () => {
    await restoreDeal({ id: dealId, actorId: ACTOR });

    const [row] = await db.select().from(deal).where(eq(deal.id, dealId));
    const [draft] = await db.select().from(document).where(eq(document.id, draftId));
    expect(row?.deletedAt).toBeNull();
    expect(draft?.deletedAt, "the draft came back with it").toBeNull();

    const offers = await listOffers({ limit: 500 });
    expect(offers.filter((o) => o.id === draftId)).toHaveLength(1);
  });

  it("leaves a draft binned on its own alone when the enquiry is restored", async () => {
    // Bin the draft by itself, an hour before the enquiry goes. Restoring the
    // enquiry must not undo somebody else's separate decision.
    const separately = new Date(Date.now() - 3_600_000);
    await db.update(document).set({ deletedAt: separately }).where(eq(document.id, draftId));

    await discardDeal({ id: dealId, reason: "again", actorId: ACTOR });
    await restoreDeal({ id: dealId, actorId: ACTOR });

    const [draft] = await db.select().from(document).where(eq(document.id, draftId));
    expect(draft?.deletedAt?.getTime()).toBe(separately.getTime());

    // Put it back for the purge tests below.
    await db.update(document).set({ deletedAt: null }).where(eq(document.id, draftId));
  });
});

describe("V3 — the bin can be emptied, and refuses what it should", () => {
  it("refuses to destroy a record that is not in the bin", async () => {
    expect(await purgeBlockedBy("deal", dealId)).toBe("notInBin");
  });

  it("refuses to destroy an enquiry that issued paper", async () => {
    // It cannot reach the bin either, so this is belt and braces — and it is
    // the check that has to hold if a row ever gets there another way.
    await db.update(deal).set({ deletedAt: new Date() }).where(eq(deal.id, issuedDealId));
    expect(await purgeBlockedBy("deal", issuedDealId)).toBe("hasIssuedDocuments");
    await db.update(deal).set({ deletedAt: null }).where(eq(deal.id, issuedDealId));
  });

  it("destroys an enquiry and its binned drafts together, keeping the audit", async () => {
    await discardDeal({ id: dealId, reason: "never existed", actorId: ACTOR });
    expect(await purgeBlockedBy("deal", dealId)).toBeNull();

    await purgeFromBin({ kind: "deal", id: dealId, actorId: ACTOR });

    const rows = await db.select().from(deal).where(eq(deal.id, dealId));
    expect(rows, "the row is gone for good").toHaveLength(0);

    const drafts = await db.select().from(document).where(eq(document.id, draftId));
    expect(drafts, "its binned draft went with it").toHaveLength(0);

    const lines = await db.select().from(dealLine).where(eq(dealLine.dealId, dealId));
    expect(lines, "the lines cascaded").toHaveLength(0);

    // THE POINT. The record is gone and the audit trail is not.
    const kept = await db
      .select()
      .from(auditEntry)
      .where(and(eq(auditEntry.actorId, ACTOR), eq(auditEntry.action, "purge")));
    expect(kept.some((e) => e.entity === "deal" && e.entityId === dealId)).toBe(true);
    expect(kept.some((e) => e.entity === "document" && e.entityId === draftId)).toBe(true);
    expect((kept.find((e) => e.entity === "deal")?.before as { ref?: string })?.ref).toBe(ENQUIRY);
  });

  it("leaves the bin without it", async () => {
    const bin = await listBin();
    expect(bin.filter((r) => r.id === dealId || r.id === draftId)).toHaveLength(0);
  });

  it("still has the enquiry that issued paper, untouched", async () => {
    const [row] = await db.select().from(deal).where(eq(deal.id, issuedDealId));
    expect(row?.deletedAt).toBeNull();
    const issued = await db
      .select()
      .from(document)
      .where(and(eq(document.dealId, issuedDealId), isNotNull(document.number)));
    expect(issued).toHaveLength(1);
  });
});
