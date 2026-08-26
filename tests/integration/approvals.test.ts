import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { approvalRequest } from "@/db/schema/approval";
import { auditEntry } from "@/db/schema/control";
import { decide, gates, isCleared, NotAllowed, request, requests } from "@/domain/approval/store";

/**
 * Screen 65, against a real database.
 *
 * The assertion that carries the design is the last one: the database itself
 * refuses a decided request that does not say who decided it. Screen 65 —
 * "a decision is timestamped and attributed" — and in a company where one man
 * is both the Gérant and the Commercial, the attribution IS the feature. A row
 * reading `approved` with a null decider recorded nothing and would be
 * indistinguishable from a gate that worked.
 */
const ASKER = "test-approvals-asker";
const DECIDER = "test-approvals-decider";
const made: string[] = [];

afterAll(async () => {
  if (made.length) await db.delete(approvalRequest).where(inArray(approvalRequest.id, made));
  await db.delete(auditEntry).where(inArray(auditEntry.actorId, [ASKER, DECIDER]));
});

describe("the gates", () => {
  it("seeds the nine on first read so the rules card has something to show", async () => {
    const all = await gates();
    expect(all).toHaveLength(9);
    expect(all.find((g) => g.code === "offer.marginBelowFloor")?.threshold).toBe(15);
    expect(all.find((g) => g.code === "document.changeIssued")?.role).toBe("nobody");
  });
});

describe("asking and deciding", () => {
  it("refuses a request with no sentence in somebody's own words", async () => {
    await expect(
      request({
        gateCode: "offer.marginBelowFloor",
        entity: "document",
        entityId: "no-such-doc",
        subject: "Margin below the floor",
        reasonCode: "matchCompetitor",
        justification: "   ",
        actorId: ASKER,
      }),
    ).rejects.toThrow(NotAllowed);
  });

  it("refuses to even ask about changing an issued document", async () => {
    // Nobody waits a day for an answer that was never possible.
    await expect(
      request({
        gateCode: "document.changeIssued",
        entity: "document",
        entityId: "x",
        subject: "Fix a typo on SUP/2026/0041",
        actorId: ASKER,
      }),
    ).rejects.toThrow(NotAllowed);
  });

  it("records the ask with its before and after frozen onto the row", async () => {
    const id = await request({
      gateCode: "offer.marginBelowFloor",
      entity: "document",
      entityId: "offer-113",
      subject: "Margin below the floor on SUP/OFF/2026/0113",
      before: { margin: "17.2%", totalExcl: "1384858" },
      after: { margin: "11.4%", totalExcl: "1302100" },
      reasonCode: "matchCompetitor",
      justification: "TouatGaz told us informally a competitor is at 1 310 000.",
      actorId: ASKER,
    });
    made.push(id);

    const [row] = await db
      .select()
      .from(approvalRequest)
      .where(eq(approvalRequest.id, id))
      .limit(1);
    expect(row?.status).toBe("waiting");
    // Frozen, not looked up. Six weeks later the before may not exist any more.
    expect((row?.before as Record<string, string> | undefined)?.margin).toBe("17.2%");
    expect((row?.after as Record<string, string> | undefined)?.margin).toBe("11.4%");
  });

  it("blocks the action until somebody decides", async () => {
    // Nothing is cleared by default: no row means nobody asked, and nobody
    // asked is not permission.
    expect(await isCleared("document", "offer-113", "offer.marginBelowFloor")).toBe(false);
    expect(await isCleared("document", "never-asked", "offer.marginBelowFloor")).toBe(false);
  });

  it("refuses a decision from somebody without the role", async () => {
    await expect(
      decide({
        requestId: made[0] as string,
        approve: true,
        role: "commercial",
        actorId: DECIDER,
      }),
    ).rejects.toThrow(NotAllowed);
  });

  it("clears the action once the Gérant approves", async () => {
    await decide({
      requestId: made[0] as string,
      approve: true,
      note: "Framework renewal in November is worth it.",
      role: "gerant",
      actorId: DECIDER,
    });

    expect(await isCleared("document", "offer-113", "offer.marginBelowFloor")).toBe(true);
  });

  it("puts the sentence in the audit log as well as on the row", async () => {
    const [entry] = await db
      .select()
      .from(auditEntry)
      .where(sql`${auditEntry.entityId} = ${made[0]} and ${auditEntry.action} = 'update'`)
      .limit(1);
    const after = entry?.after as Record<string, unknown>;

    // This is the thing somebody reads in six months to answer "why was the
    // margin 11.4% on that job".
    expect(after?.justification).toContain("competitor is at 1 310 000");
    expect(after?.selfApproved).toBe(false);
    expect(entry?.reason).toBe("matchCompetitor");
    expect(entry?.sourceScreen).toBe("65");
  });

  it("refuses a second decision on the same request", async () => {
    await expect(
      decide({ requestId: made[0] as string, approve: false, role: "gerant", actorId: DECIDER }),
    ).rejects.toThrow(NotAllowed);
  });

  it("records a self-approval as one rather than refusing it", async () => {
    const id = await request({
      gateCode: "invoice.writeOff",
      entity: "document",
      entityId: "inv-9",
      subject: "Write off 84 200 DZD",
      reasonCode: "other",
      justification: "Client dissolved; the receiver confirmed nothing is recoverable.",
      actorId: DECIDER,
    });
    made.push(id);

    await decide({ requestId: id, approve: true, role: "gerant", actorId: DECIDER });

    const [row] = await db
      .select()
      .from(approvalRequest)
      .where(eq(approvalRequest.id, id))
      .limit(1);
    // Allowed — refusing would teach somebody to stop asking, and not asking
    // loses the record entirely.
    expect(row?.status).toBe("approved");
    expect(row?.selfApproved).toBe(true);
  });

  it("leaves a declined request's subject alone — the draft is not the gate's", async () => {
    const id = await request({
      gateCode: "offer.discountAbove",
      entity: "document",
      entityId: "offer-114",
      subject: "Discount of 12% on SUP/OFF/2026/0114",
      reasonCode: "strategicClient",
      justification: "They have taken four orders this year.",
      actorId: ASKER,
    });
    made.push(id);

    await decide({
      requestId: id,
      approve: false,
      note: "Take it to 9% and I will sign it.",
      role: "gerant",
      actorId: DECIDER,
    });

    const [row] = await db
      .select()
      .from(approvalRequest)
      .where(eq(approvalRequest.id, id))
      .limit(1);
    expect(row?.status).toBe("declined");
    // "The draft stays, nothing is lost" — and the note is where the person who
    // asked finds out what to change.
    expect(row?.decisionNote).toBe("Take it to 9% and I will sign it.");
    expect(await isCleared("document", "offer-114", "offer.discountAbove")).toBe(false);
  });

  it("is refused by the DATABASE too when a decision names nobody", async () => {
    // The domain checks first so a person meets a sentence rather than a
    // five-hundred. The rule lives in the database as well, because a future
    // screen that forgets to attribute must not be able to record a decision
    // that answers nothing.
    const id = await request({
      gateCode: "invoice.writeOff",
      entity: "document",
      entityId: "inv-10",
      subject: "Write off 12 000 DZD",
      reasonCode: "other",
      justification: "Rounding on a settled account.",
      actorId: ASKER,
    });
    made.push(id);

    await expect(
      db.update(approvalRequest).set({ status: "approved" }).where(eq(approvalRequest.id, id)),
    ).rejects.toThrow();
  });

  it("lists what is still waiting apart from what has been decided", async () => {
    const waiting = (await requests({ status: "waiting" })).filter((r) => made.includes(r.id));
    expect(waiting.map((r) => r.subject)).toEqual(["Write off 12 000 DZD"]);
  });
});
