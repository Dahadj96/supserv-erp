import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { whatIsLate } from "@/assistant/late";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal } from "@/db/schema/deal";
import { party, partyRole } from "@/db/schema/party";
import { createDeal } from "@/domain/deal/deal";

/**
 * PLAN §7: "the assistant can answer 'what is late and why' with citations".
 *
 * This is that sentence, as a test. It puts one real overdue thing in the
 * database and checks the answer finds it, says why, and hands back a link a
 * person can open to see the same row.
 */
const ACTOR = "test-assistant-actor";
const CLIENT = "TEST-AS-CLIENT";

let clientId: string;
const dealIds: string[] = [];

const HOUR = 3_600_000;

beforeAll(async () => {
  await db.delete(party).where(eq(party.code, CLIENT));

  const [made] = await db
    .insert(party)
    .values({ code: CLIENT, legalName: "TOUATGAZ TEST", docLocale: "fr" })
    .returning({ id: party.id });
  clientId = made?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });
});

afterAll(async () => {
  if (dealIds.length) await db.delete(deal).where(inArray(deal.id, dealIds));
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  await db.delete(partyRole).where(eq(partyRole.partyId, clientId));
  await db.delete(party).where(eq(party.id, clientId));
});

async function makeDeal(deadlineAt: Date | null, subject: string): Promise<string> {
  // Through the domain, not a raw insert: `createDeal` allocates the reference,
  // and a fixture that invents one would be testing a deal shaped differently
  // from every real one.
  const id = await createDeal(
    {
      partyId: clientId,
      subject,
      contactPersonId: null,
      clientReference: null,
      receivedAt: new Date(),
      deadlineAt,
      submissionMethod: "deposit_sealed",
      currency: "DZD",
      ownerId: null,
      source: "manual",
      intakeMessageId: null,
      expectedValue: null,
      clientInstructions: null,
    },
    ACTOR,
  );

  dealIds.push(id);
  return id;
}

describe("what is late, and why", () => {
  it("finds a deadline that has already passed, and says how long ago", async () => {
    const now = new Date();
    const id = await makeDeal(new Date(now.getTime() - 30 * HOUR), "TEST late tender");

    const answer = await whatIsLate(now);
    const found = answer.things.find((thing) => thing.id.includes(id));

    expect(found, "a passed deadline should be in the answer").toBeDefined();
    expect(found?.why.reason).toBe("deadlinePassed");
    if (found?.why.reason === "deadlinePassed") {
      // About thirty hours. Exact to the hour would be a test of the clock.
      expect(found.why.hours).toBeGreaterThanOrEqual(29);
      expect(found.why.hours).toBeLessThanOrEqual(31);
    }
  });

  it("cites a screen where the same row can be seen", async () => {
    const now = new Date();
    const id = await makeDeal(new Date(now.getTime() - 5 * HOUR), "TEST cited tender");

    const answer = await whatIsLate(now);
    const found = answer.things.find((thing) => thing.id.includes(id));

    // The whole point of "with citations". A link that goes nowhere, or a claim
    // with no link, is a rumour.
    expect(found?.citation).toBe(`/deals/${id}`);
  });

  it("separates a deadline about to pass from one already gone", async () => {
    const now = new Date();
    const soon = await makeDeal(new Date(now.getTime() + 20 * HOUR), "TEST imminent tender");

    const answer = await whatIsLate(now);
    const found = answer.things.find((thing) => thing.id.includes(soon));

    expect(found?.why.reason).toBe("deadlineImminent");
  });

  it("leaves a deadline that is comfortably away out of it", async () => {
    const now = new Date();
    const far = await makeDeal(new Date(now.getTime() + 30 * 24 * HOUR), "TEST far tender");

    const answer = await whatIsLate(now);
    expect(answer.things.find((thing) => thing.id.includes(far))).toBeUndefined();
  });

  it("puts what is already lost above what is merely close", async () => {
    const now = new Date();
    const answer = await whatIsLate(now);

    const reasons = answer.things.map((thing) => thing.why.reason);
    const lastPassed = reasons.lastIndexOf("deadlinePassed");
    const firstImminent = reasons.indexOf("deadlineImminent");

    if (lastPassed >= 0 && firstImminent >= 0) {
      expect(lastPassed).toBeLessThan(firstImminent);
    }
  });

  it("says how much it examined, so silence can be told from emptiness", async () => {
    // "Nothing is late" and "nothing was checked" look identical without this.
    const answer = await whatIsLate(new Date());
    expect(answer.examined).toBeGreaterThanOrEqual(answer.things.length);
  });

  it("changes nothing", async () => {
    // LAW 6, at the only level that matters: asking the assistant a question
    // must not leave a mark on the business.
    const before = await db.select({ id: deal.id, subject: deal.subject }).from(deal);
    await whatIsLate(new Date());
    const after = await db.select({ id: deal.id, subject: deal.subject }).from(deal);

    expect(after).toEqual(before);
  });
});
