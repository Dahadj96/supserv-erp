import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine } from "@/db/schema/deal";
import { party, partyRole } from "@/db/schema/party";
import { sourcingRequest, sourcingResponse } from "@/db/schema/sourcing";
import { createDeal } from "@/domain/deal/deal";
import { compare, conflictsOf, replyRate, totalFor, worthChasing } from "@/domain/deal/sourcing";
import {
  createRequest,
  markSent,
  recordAnswer,
  recordChase,
  requestFor,
  requestsForDeal,
  SourcingRefused,
} from "@/domain/deal/sourcing-store";

/**
 * Screens 09, 10 and 67, against a real database.
 *
 * The pure arithmetic is covered in `tests/unit/sourcing.test.ts`. What is
 * checked here is the part that cannot be: that a bounced supplier survives a
 * round trip through Postgres still distinguishable from a silent one, and that
 * the constraints refuse what the domain refuses.
 */
const ACTOR = "test-sourcing-actor";
const stamp = Date.now().toString().slice(-5);

let clientId = "";
let dealId = "";
let lineIds: string[] = [];
const supplierIds: string[] = [];
const requests: string[] = [];

beforeAll(async () => {
  const [client] = await db
    .insert(party)
    .values({ code: `CL-T8${stamp}`, legalName: "TEST SRC CLIENT" })
    .returning({ id: party.id });
  clientId = client?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });

  for (const [i, name] of ["HYDRO-EQUIP", "VANNE ALGERIE", "TECHNO FLUIDES"].entries()) {
    const [supplier] = await db
      .insert(party)
      .values({ code: `SU-T8${stamp}${i}`, legalName: `TEST SRC ${name}` })
      .returning({ id: party.id });
    supplierIds.push(supplier?.id as string);
    await db.insert(partyRole).values({ partyId: supplier?.id as string, role: "supplier" });
  }

  dealId = await createDeal(
    {
      partyId: clientId,
      subject: "Vannes et raccords",
      contactPersonId: null,
      clientReference: null,
      receivedAt: new Date(),
      deadlineAt: new Date(Date.UTC(2026, 7, 20, 12)),
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

  // What the client requires, confirmed by a person. Without these the conflict
  // checks correctly say nothing.
  await db
    .update(deal)
    .set({ requiredValidityDays: 90, requiredDeliveryDays: 21, latePenalty: "1‰ par jour" })
    .where(eq(deal.id, dealId));

  const inserted = await db
    .insert(dealLine)
    .values([
      { dealId, position: 1, designation: "Vanne papillon DN80", qty: "12", unit: "pc" },
      { dealId, position: 2, designation: 'Raccord bride 2"', qty: "40", unit: "pc" },
    ])
    .returning({ id: dealLine.id });
  lineIds = inserted.map((r) => r.id);
});

afterAll(async () => {
  await db.delete(sourcingRequest).where(eq(sourcingRequest.dealId, dealId));
  await db.delete(dealLine).where(eq(dealLine.dealId, dealId));
  await db.delete(deal).where(eq(deal.id, dealId));
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  const all = [clientId, ...supplierIds].filter(Boolean);
  await db.delete(partyRole).where(inArray(partyRole.partyId, all));
  await db.delete(party).where(inArray(party.id, all));
});

describe("asking suppliers", () => {
  it("creates a request drafted, not sent", async () => {
    const id = await createRequest({
      dealId,
      subject: "Vannes et raccords",
      supplierIds,
      replyBy: new Date(Date.UTC(2026, 7, 17, 17)),
      actorId: ACTOR,
    });
    requests.push(id);

    const found = await requestFor(id);
    expect(found?.request.ref).toMatch(/^SR-\d{4}-\d{4}$/);
    expect(found?.request.sentAt).toBeNull();
    expect(found?.answers).toHaveLength(3);
    expect(found?.answers.every((a) => a.status === "asked")).toBe(true);
  });

  it("does not ask the same supplier twice because somebody clicked twice", async () => {
    const id = await createRequest({
      dealId,
      subject: "Doublon",
      supplierIds: [supplierIds[0] as string, supplierIds[0] as string],
      actorId: ACTOR,
    });
    requests.push(id);
    expect((await requestFor(id))?.answers).toHaveLength(1);
  });

  it("refuses a request with nobody to ask", async () => {
    await expect(
      createRequest({ dealId, subject: "Personne", supplierIds: [], actorId: ACTOR }),
    ).rejects.toThrow(SourcingRefused);
  });

  it("will not send the same request twice", async () => {
    const id = requests[1] as string;
    await markSent({ requestId: id, actorId: ACTOR });
    await expect(markSent({ requestId: id, actorId: ACTOR })).rejects.toThrow(SourcingRefused);
  });
});

describe("what the suppliers said", () => {
  it("keeps a bounced address distinguishable from a silence", async () => {
    const id = requests[0] as string;
    await markSent({ requestId: id, actorId: ACTOR });
    const before = await requestFor(id);
    const [hydro, vanne, techno] = before?.answers ?? [];

    await recordAnswer({
      responseId: hydro?.responseId as string,
      status: "quoted",
      validityDays: 30,
      leadTimeDays: 21,
      prices: { [lineIds[0] as string]: "38400", [lineIds[1] as string]: "2610" },
      actorId: ACTOR,
    });
    await recordAnswer({
      responseId: vanne?.responseId as string,
      status: "quoted",
      validityDays: 90,
      leadTimeDays: 34,
      prices: { [lineIds[0] as string]: "41100", [lineIds[1] as string]: "2480" },
      actorId: ACTOR,
    });
    await recordAnswer({
      responseId: techno?.responseId as string,
      status: "bounced",
      actorId: ACTOR,
    });

    const after = await requestFor(id);
    const rate = replyRate(after?.answers ?? []);
    expect(rate).toMatchObject({ asked: 3, quoted: 2, bounced: 1, no_reply: 0 });

    // And the broken address is not on the chase list. Chasing it forever is
    // how a supplier quietly drops out of every comparison for a year.
    expect(worthChasing(after?.answers ?? [])).toHaveLength(0);
  });

  it("does not keep terms against a supplier who is not quoting", async () => {
    // The database says the same thing (migration 0018), but a person who
    // changes "quoted" to "declined" should not meet a constraint violation.
    const id = requests[0] as string;
    const found = await requestFor(id);
    const hydro = found?.answers[0];

    await recordAnswer({
      responseId: hydro?.responseId as string,
      status: "declined",
      validityDays: 30,
      leadTimeDays: 21,
      actorId: ACTOR,
    });

    const after = await requestFor(id);
    const changed = after?.answers.find((a) => a.responseId === hydro?.responseId);
    expect(changed?.status).toBe("declined");
    expect(changed?.validityDays).toBeNull();
    // And their prices went with the quote they withdrew.
    expect(changed?.prices.size).toBe(0);

    // Put it back for the conflict test below.
    await recordAnswer({
      responseId: hydro?.responseId as string,
      status: "quoted",
      validityDays: 30,
      leadTimeDays: 21,
      prices: { [lineIds[0] as string]: "38400", [lineIds[1] as string]: "2610" },
      actorId: ACTOR,
    });
  });

  it("refuses a status nobody has heard of", async () => {
    const found = await requestFor(requests[0] as string);
    await expect(
      recordAnswer({
        responseId: found?.answers[0]?.responseId as string,
        status: "thinking about it",
        actorId: ACTOR,
      }),
    ).rejects.toThrow(SourcingRefused);
  });
});

describe("the conflicts survive a round trip", () => {
  it("finds the short validity and the long lead time against real rows", async () => {
    const found = await requestFor(requests[0] as string);
    const lines = (found?.lines ?? []).map((l) => ({ lineId: l.id, qty: l.qty }));

    const conflicts = conflictsOf({
      requires: found?.requires as never,
      answers: found?.answers ?? [],
      lineIds: lines.map((l) => l.lineId),
      quotedOn: found?.quotedOn as never,
      total: (a) => totalFor(a, lines) ?? "0",
    });

    expect(conflicts.map((c) => c.kind)).toEqual([
      "validityShorterThanRequired",
      "leadTimeLongerThanRequired",
    ]);
    expect(conflicts[0]?.detail.shortBy).toBe(60);
    expect(conflicts[1]?.detail.penalty).toBe("1‰ par jour");
  });

  it("compares the two quotes line by line", async () => {
    const found = await requestFor(requests[0] as string);
    const lines = (found?.lines ?? []).map((l) => ({ lineId: l.id, qty: l.qty }));
    const result = compare(found?.answers ?? [], lines);

    // 12 × 38 400 = 460 800 from Hydro; 40 × 2 480 = 99 200 from Vanne.
    expect(result.splitTotal).toBe("560000.00");
    expect(result.splitSuppliers).toBe(2);
  });
});

describe("chasing", () => {
  it("counts the chase without sending anything", async () => {
    const found = await requestFor(requests[1] as string);
    const target = found?.answers[0]?.responseId as string;
    expect(await recordChase({ responseIds: [target], actorId: ACTOR })).toBe(1);

    const [row] = await db
      .select({ n: sourcingResponse.chasedCount })
      .from(sourcingResponse)
      .where(eq(sourcingResponse.id, target));
    expect(row?.n).toBe(1);
  });
});

describe("every request on an enquiry", () => {
  it("shows how many were asked and how many answered", async () => {
    const rows = await requestsForDeal(dealId);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const first = rows.find((r) => r.id === requests[0]);
    expect(first?.asked).toBe(3);
    expect(first?.quoted).toBe(2);
  });
});
