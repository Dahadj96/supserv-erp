import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { intakeChannel, intakeMessage } from "@/db/schema/intake";
import { party, partyRole, person } from "@/db/schema/party";
import { ensureIntakeConfigured } from "@/domain/intake/channels";
import { commitAvailability, commitCandidate, commitContact } from "@/domain/intake/commit";
import {
  dismiss,
  expiringSoon,
  inboxCounts,
  listInbox,
  markRead,
  needsAHuman,
  reclassify,
} from "@/domain/intake/inbox";

/**
 * Screen 02. docs/PLAN.md's phase-2 test is "none of the twelve expire unread",
 * so what is proved here is that a thing with a deadline sorts to the top, is
 * named in the banner while there is still time, and cannot leave the inbox
 * except by somebody deciding it should.
 */
const CLIENT = "TEST-IN-CLIENT";
const ACTOR = "test-inbox-actor";

let clientId: string;
const messageIds: string[] = [];
const personIds: string[] = [];

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000);

beforeAll(async () => {
  await ensureIntakeConfigured();
  await db.delete(party).where(eq(party.code, CLIENT));

  const [c] = await db
    .insert(party)
    .values({ code: CLIENT, legalName: "URBACON TEST", email: "contact@urbacon-test.dz" })
    .returning({ id: party.id });
  clientId = c?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });

  const rows = await db
    .insert(intakeMessage)
    .values([
      {
        channelKey: "mailbox",
        externalId: "TEST-IN-1",
        receivedAt: hoursFromNow(-48),
        fromAddress: "achats@urbacon-test.dz",
        fromName: "URBACON (UCC)",
        subject: "PR 3000116322 - Fridges & water fountains",
        partyId: clientId,
        classifiedAs: "enquiry",
        confidence: "0.900",
        // Closest deadline. Must sort first even though it arrived first.
        deadlineAt: hoursFromNow(22),
        raw: { downgraded: false },
      },
      {
        channelKey: "mailbox",
        externalId: "TEST-IN-2",
        receivedAt: hoursFromNow(-2),
        fromAddress: "nedn40527@gmail.com",
        fromName: "Nadir Benali",
        subject: "Candidature - Soudeur / Plombier",
        classifiedAs: "candidate",
        confidence: "0.920",
        raw: { downgraded: false },
      },
      {
        channelKey: "mailbox",
        externalId: "TEST-IN-3",
        receivedAt: hoursFromNow(-10),
        fromAddress: "no-reply@algex-test.dz",
        subject: "Bulletin des appels d'offres publiques n 3412",
        classifiedAs: "needsReview",
        confidence: "0.000",
        raw: { downgraded: false },
      },
      {
        channelKey: "mailbox",
        externalId: "TEST-IN-4",
        receivedAt: hoursFromNow(-5),
        fromAddress: "a.himer@urbacon-test.dz",
        fromName: "A. Himer",
        subject: "Question sur la livraison",
        partyId: clientId,
        classifiedAs: "enquiry",
        confidence: "0.510",
        // The confidence floor stopped this one. It belongs in "needs a human".
        raw: { downgraded: true },
      },
    ])
    .returning({ id: intakeMessage.id });
  messageIds.push(...rows.map((r) => r.id));
});

afterAll(async () => {
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  await db.delete(person).where(inArray(person.id, personIds));
  await db.delete(intakeMessage).where(like(intakeMessage.externalId, "TEST-IN-%"));
  await db.delete(partyRole).where(eq(partyRole.partyId, clientId));
  await db.delete(party).where(eq(party.code, CLIENT));
});

describe("screen 02 — nothing expires unread", () => {
  it("puts the thing with a deadline at the top, whenever it arrived", async () => {
    const rows = await listInbox("all", { limit: 500 });
    const mine = rows.filter((r) => messageIds.includes(r.id));
    expect(mine[0]?.subject).toContain("PR 3000116322");
    // It arrived two days ago; the CV arrived two hours ago. The deadline wins.
    expect(mine[0]?.hoursLeft).toBeGreaterThan(0);
    expect(mine[0]?.hoursLeft).toBeLessThanOrEqual(48);
  });

  it("names what is expiring rather than counting it", async () => {
    const soon = await expiringSoon(5);
    const hit = soon.find((s) => s.subject?.includes("PR 3000116322"));
    expect(hit, "a number says there is a problem; a name says which one").toBeDefined();
    expect(hit?.partyName).toBe("URBACON TEST");
  });

  it("marks a deadline nobody has confirmed as unconfirmed", async () => {
    const rows = await listInbox("all", { limit: 500 });
    const row = rows.find((r) => r.subject?.includes("PR 3000116322"));
    // LAW 2 — extraction read it, nobody confirmed it. It warns; nothing relies on it.
    expect(row?.deadlineConfirmed).toBe(false);
  });

  it("counts unread separately from total", async () => {
    const before = await inboxCounts();
    await markRead(messageIds[1] as string);
    const after = await inboxCounts();
    expect(after.unread).toBe(before.unread - 1);
    expect(after.all, "reading something does not remove it").toBe(before.all);
  });

  it("collects both kinds of uncertainty in one place", async () => {
    const unsure = await needsAHuman(50);
    const ids = unsure.map((u) => u.id);
    // Nothing matched at all...
    expect(ids).toContain(messageIds[2]);
    // ...and the one the confidence floor stopped.
    expect(ids).toContain(messageIds[3]);
    expect(unsure.find((u) => u.id === messageIds[3])?.downgraded).toBe(true);
  });

  it("dismisses without deleting, and says who and why", async () => {
    const id = messageIds[2] as string;
    await dismiss(id, ACTOR, "abonnement, pas un avis");

    const rows = await listInbox("all", { limit: 500 });
    expect(
      rows.map((r) => r.id),
      "it left the inbox",
    ).not.toContain(id);

    const [still] = await db.select().from(intakeMessage).where(eq(intakeMessage.id, id));
    expect(still, "an email nobody can find again is worse than one nobody read").toBeDefined();
    expect(still?.status).toBe("dismissed");

    const [logged] = await db.select().from(auditEntry).where(eq(auditEntry.entityId, id));
    expect(logged?.action).toBe("dismiss");
    expect(logged?.reason).toBe("abonnement, pas un avis");
  });

  it("treats a person's classification as certain", async () => {
    const id = messageIds[3] as string;
    await reclassify(id, "enquiry", ACTOR);
    const [row] = await db.select().from(intakeMessage).where(eq(intakeMessage.id, id));
    // The floor exists to stop the machine acting alone, not to doubt somebody
    // who read the email.
    expect(Number(row?.confidence)).toBe(1);
    expect(row?.status).toBe("classified");
  });

  it("turns a CV into a candidate, and refuses to guess the trade", async () => {
    const id = messageIds[1] as string;
    await expect(commitCandidate({ messageId: id, actorId: ACTOR, trade: "  " })).rejects.toThrow(
      /tradeRequired/,
    );

    const personId = await commitCandidate({
      messageId: id,
      actorId: ACTOR,
      trade: "Soudeur / plombier",
    });
    personIds.push(personId);

    const [created] = await db.select().from(person).where(eq(person.id, personId));
    expect(created?.fullName).toBe("Nadir Benali");
    expect(created?.relationship).toBe("candidate");
    expect(created?.source).toBe("cv");

    const rows = await listInbox("all", { limit: 500 });
    expect(
      rows.map((r) => r.id),
      "committed rows leave the inbox",
    ).not.toContain(id);
  });

  it("turns a new sender at a known client into a verified contact", async () => {
    const id = messageIds[3] as string;
    const personId = await commitContact({ messageId: id, actorId: ACTOR, job: "Achats" });
    personIds.push(personId);

    const [created] = await db.select().from(person).where(eq(person.id, personId));
    expect(created?.fullName).toBe("A. Himer");
    expect(created?.employerPartyId).toBe(clientId);
    // They wrote to us, so the address demonstrably reaches them.
    expect(created?.verifiedAt).not.toBeNull();
  });

  it("says which actions have somewhere to write, and what the rest are missing", () => {
    // This test used to assert `{ available: false, phase: 4 }` for an enquiry,
    // and it went on asserting it for a fortnight after phase 4 shipped —
    // which is exactly the rot that replaced `COMMIT_PHASE` with
    // `COMMIT_BLOCKER`. A phase number is a promise nobody owns; a blocker
    // names the missing thing, and the person who supplies it deletes the line.
    expect(commitAvailability("candidate").available).toBe(true);
    expect(commitAvailability("enquiry").available).toBe(true);

    // Both destinations exist. What is missing is a person saying WHICH.
    expect(commitAvailability("supplierQuote")).toEqual({
      available: false,
      blocker: "inbox.blocked.needsSourcingPicker",
    });
    expect(commitAvailability("payment")).toEqual({
      available: false,
      blocker: "inbox.blocked.needsInvoicePicker",
    });
  });

  it("knows the mailbox channel exists", async () => {
    const [row] = await db.select().from(intakeChannel).where(eq(intakeChannel.key, "mailbox"));
    expect(row?.status).toBe("live");
    expect(row?.autoClassify).toBe(true);
  });
});
