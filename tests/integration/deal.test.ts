import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine } from "@/db/schema/deal";
import { document } from "@/db/schema/document";
import { party, partyRole } from "@/db/schema/party";
import { sourcingRequest, sourcingResponse } from "@/db/schema/sourcing";
import {
  createDeal,
  DecisionRefused,
  decide,
  getDeal,
  listDeals,
  nextDealRef,
  recordLost,
  reopen,
} from "@/domain/deal/deal";

/**
 * Screens 05 and 06 — the enquiry, against a real database.
 *
 * The thing worth checking here is the one the unit tests cannot: that the
 * stage really does fall out of the documents, with no column anywhere holding
 * a second opinion.
 */
const ACTOR = "test-deal-actor";
let clientId = "";
const made: string[] = [];

beforeAll(async () => {
  const [client] = await db
    .insert(party)
    .values({
      // A code shaped like a real one. `nextCode` in the importer counts from
      // these, and a test fixture that does not fit the shape used to break it
      // — see "is not derailed by a company whose code we did not allocate".
      code: `CL-9${Date.now().toString().slice(-5)}`,
      legalName: "GROUPEMENT TOUATGAZ",
      tradeName: "TOUATGAZ",
    })
    .returning({ id: party.id });
  clientId = client?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });
});

afterAll(async () => {
  if (made.length) {
    // Requests cascade to responses and lines; deals cascade to requests.
    await db.delete(sourcingRequest).where(inArray(sourcingRequest.dealId, made));
    await db.delete(document).where(inArray(document.dealId, made));
    await db.delete(dealLine).where(inArray(dealLine.dealId, made));
    await db.delete(deal).where(inArray(deal.id, made));
  }
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  if (clientId) {
    await db.delete(partyRole).where(eq(partyRole.partyId, clientId));
    await db.delete(party).where(eq(party.id, clientId));
  }
});

async function make(over: Partial<Parameters<typeof createDeal>[0]> = {}) {
  const id = await createDeal(
    {
      partyId: clientId,
      subject: "Vannes et raccords",
      contactPersonId: null,
      clientReference: "25/DA/2026",
      receivedAt: new Date(),
      deadlineAt: null,
      submissionMethod: "deposit_sealed",
      currency: "DZD",
      ownerId: null,
      source: "manual",
      intakeMessageId: null,
      expectedValue: null,
      clientInstructions: null,
      ...over,
    },
    ACTOR,
  );
  made.push(id);
  return id;
}

describe("an enquiry arrives", () => {
  it("gets a reference of ours and keeps theirs verbatim", async () => {
    const id = await make();
    const found = await getDeal(id);
    expect(found?.deal.ref).toMatch(/^ENQ-\d{4}-\d{4}$/);
    // Their reference is not parsed, not padded, not upper-cased.
    expect(found?.deal.clientReference).toBe("25/DA/2026");
  });

  it("allocates the next reference, not a random one", async () => {
    const first = await getDeal(await make());
    const second = await getDeal(await make());
    const n = (ref: string) => Number(ref.slice(-4));
    expect(n(second?.deal.ref as string)).toBe(n(first?.deal.ref as string) + 1);
  });

  it("starts at new, with nothing derived from nothing", async () => {
    const found = await getDeal(await make());
    expect(found?.stage).toBe("new");
    expect(found?.badge).toBe("new");
    expect(found?.open).toBe(true);
  });

  it("writes an audit entry naming the screen", async () => {
    const id = await make();
    const [entry] = await db.select().from(auditEntry).where(eq(auditEntry.entityId, id)).limit(1);
    expect(entry?.sourceScreen).toBe("05");
  });
});

describe("the stage falls out of the documents", () => {
  it("has no column to fall out of", async () => {
    // The strongest form of this test: there is no `stage` column at all, so
    // there is no place for a second opinion to live.
    const columns = Object.keys(deal);
    expect(columns).not.toContain("stage");
    expect(columns).not.toContain("status");
  });

  it("moves to offer out when an offer is issued, and not before", async () => {
    const id = await make();
    await db.insert(dealLine).values({
      dealId: id,
      position: 1,
      reference: "VP-DN80-16",
      designation: "Vanne papillon DN80 PN16, corps fonte",
      qty: "12",
      unit: "pc",
    });
    expect((await getDeal(id))?.stage).toBe("qualifying");

    // A DRAFT offer. No number — LAW 5. The client has never seen it.
    const [draft] = await db
      .insert(document)
      .values({
        kind: "quotation",
        partyId: clientId,
        dealId: id,
        locale: "fr",
        totals: {},
      })
      .returning({ id: document.id });
    expect((await getDeal(id))?.stage).toBe("qualifying");

    // Issued. Now it is out.
    await db
      .update(document)
      .set({ number: "DEV-2026-0007", issuedOn: "2026-08-19", status: "issued" })
      .where(eq(document.id, draft?.id as string));
    expect((await getDeal(id))?.stage).toBe("offerOut");
  });

  it("is won when their order arrives, with nobody ticking anything", async () => {
    const id = await make();
    await db.insert(document).values({
      kind: "client_order",
      partyId: clientId,
      dealId: id,
      locale: "fr",
      // Their number, not ours — a client order never consumes one of our
      // series (screen 50, `clientReference` numbering).
      number: "PO-77120",
      totals: {},
    });
    const found = await getDeal(id);
    expect(found?.stage).toBe("ordered");
    expect(found?.badge).toBe("won");
    expect(found?.open).toBe(false);
  });

  it("counts suppliers on a SENT request, and ignores a draft one", async () => {
    const id = await make();
    const [request] = await db
      .insert(sourcingRequest)
      .values({ ref: `SR-TEST-${Date.now().toString().slice(-6)}`, dealId: id, subject: "Vannes" })
      .returning({ id: sourcingRequest.id });
    await db
      .insert(sourcingResponse)
      .values({ requestId: request?.id as string, partyId: clientId });

    // Drafted, not sent. Somebody thinking about sourcing is not sourcing —
    // the same line `offersIssued` draws between a draft and an offer out.
    expect((await getDeal(id))?.facts.suppliersAsked).toBe(0);
    // Still `new`: no lines typed in, no decision recorded, and a draft request
    // is not evidence that anybody is working on it.
    expect((await getDeal(id))?.stage).toBe("new");

    await db
      .update(sourcingRequest)
      .set({ sentAt: new Date() })
      .where(eq(sourcingRequest.id, request?.id as string));

    const found = await getDeal(id);
    expect(found?.facts.suppliersAsked).toBe(1);
    expect(found?.stage).toBe("sourcing");
  });
});

describe("the go / no-go card", () => {
  it("refuses a no-bid with no reason", async () => {
    const id = await make();
    await expect(decide({ dealId: id, decision: "no_bid", actorId: ACTOR })).rejects.toThrow(
      DecisionRefused,
    );
    expect((await getDeal(id))?.deal.decision).toBeNull();
  });

  it("refuses a reason nobody can count", async () => {
    const id = await make();
    await expect(
      decide({
        dealId: id,
        decision: "no_bid",
        reason: "just did not fancy it" as never,
        actorId: ACTOR,
      }),
    ).rejects.toThrow(DecisionRefused);
  });

  it("records the no-bid, its reason, and keeps the stage it reached", async () => {
    const id = await make();
    await db.insert(dealLine).values({
      dealId: id,
      position: 1,
      designation: "Groupe électrogène 250 kVA",
      qty: "1",
    });
    await decide({
      dealId: id,
      decision: "no_bid",
      reason: "deadlineImpossible",
      note: "consultation reçue 3 jours avant la date limite",
      actorId: ACTOR,
    });

    const found = await getDeal(id);
    expect(found?.badge).toBe("noBid");
    // Still qualifying. You can see how far it got before the no.
    expect(found?.stage).toBe("qualifying");
    expect(found?.deal.decisionReason).toContain("deadlineImpossible");
    expect(found?.deal.decisionReason).toContain("3 jours");
  });

  it("lets somebody change their mind", async () => {
    const id = await make();
    await decide({ dealId: id, decision: "no_bid", reason: "paymentTerms", actorId: ACTOR });
    await decide({ dealId: id, decision: "pursue", actorId: ACTOR });
    const found = await getDeal(id);
    expect(found?.deal.decision).toBe("pursue");
    expect(found?.open).toBe(true);
  });

  it("will not let a mis-click no-bid something already won", async () => {
    const id = await make();
    await db.insert(document).values({
      kind: "client_order",
      partyId: clientId,
      dealId: id,
      locale: "fr",
      number: "PO-77121",
      totals: {},
    });
    await expect(
      decide({ dealId: id, decision: "no_bid", reason: "priceNotCompetitive", actorId: ACTOR }),
    ).rejects.toThrow(DecisionRefused);
  });
});

describe("lost, which nothing else can tell us", () => {
  it("is recorded with a reason and is reversible", async () => {
    const id = await make();
    await recordLost({ dealId: id, reason: "SARL Hydro-Equip 8% moins cher", actorId: ACTOR });

    let found = await getDeal(id);
    expect(found?.badge).toBe("lost");
    expect(found?.open).toBe(false);
    // The deadline column stops shouting about a date nobody cares about.
    expect(found?.deadline.kind).toBe("closed");

    await reopen({ dealId: id, actorId: ACTOR });
    found = await getDeal(id);
    expect(found?.open).toBe(true);
    expect(found?.deal.lostReason).toBeNull();
  });

  it("refuses a lost with no reason", async () => {
    const id = await make();
    await expect(recordLost({ dealId: id, reason: "   ", actorId: ACTOR })).rejects.toThrow(
      DecisionRefused,
    );
  });
});

describe("the list", () => {
  it("counts the chips over everything, not over the filter", async () => {
    const listed = await listDeals({ stage: "new" });
    // Every row returned is in the stage asked for...
    expect(listed.rows.every((r) => r.stage === "new")).toBe(true);
    // ...but the chip counts still describe the whole list, so pressing a chip
    // never changes the number written on it.
    expect(listed.counts.all).toBeGreaterThanOrEqual(listed.rows.length);
  });

  it("can hide what is finished", async () => {
    const open = await listDeals({ openOnly: true });
    expect(open.rows.every((r) => r.open)).toBe(true);
  });
});

describe("the reference allocator", () => {
  it("is asked for the next one inside the transaction that uses it", async () => {
    // Not a concurrency test — a shape test. `nextDealRef` takes the executor
    // so `createDeal` can hand it the transaction rather than the pool, which
    // is what stops two people opening two emails from both getting 0141.
    const ref = await nextDealRef(db, new Date());
    expect(ref).toMatch(/^ENQ-\d{4}-\d{4}$/);
  });
});
