import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal } from "@/db/schema/deal";
import { note } from "@/db/schema/note";
import { party, partyRole } from "@/db/schema/party";
import { addNote, NoteRefused, notesDue, timelineFor } from "@/domain/timeline/gather";
import { today } from "@/domain/today/list";

/**
 * Screen 56's one table, and the seam it opens onto screen 55.
 *
 * A note is the ONLY row on a deal timeline that exists nowhere else. "Called
 * A&C purchasing about the deposit window — they confirmed the office accepts
 * deposits from 08:00. Bring two sealed envelopes." Nothing in this system saw
 * that; it exists because somebody put the phone down and typed it.
 *
 * It is not a task table. Screen 55 refuses one because a task duplicates
 * state — an invoice is unpaid OR the task to chase it is open, and the two
 * drift. A note duplicates nothing. `dueAt` is where the two ideas meet: a
 * dated note is what a person means by a task, written once here and READ by
 * Today rather than copied into a second list.
 */
const ACTOR = "test-notes-actor";
const stamp = Date.now().toString().slice(-5);

let clientId = "";
let dealId = "";
const made: string[] = [];

beforeAll(async () => {
  const [client] = await db
    .insert(party)
    .values({ code: `CL-N${stamp}`, legalName: "TEST NOTE TOUATGAZ" })
    .returning({ id: party.id });
  clientId = client?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });

  const [row] = await db
    .insert(deal)
    .values({
      ref: `NOTE-${stamp}-0141`,
      partyId: clientId,
      subject: "Vannes et raccords",
      receivedAt: new Date("2026-08-14T11:03:00Z"),
      currency: "DZD",
    })
    .returning({ id: deal.id });
  dealId = row?.id as string;
});

afterAll(async () => {
  if (made.length) await db.delete(note).where(inArray(note.id, made));
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  await db.delete(deal).where(eq(deal.id, dealId));
  await db.delete(partyRole).where(eq(partyRole.partyId, clientId));
  await db.delete(party).where(eq(party.id, clientId));
});

describe("writing down what the system never saw", () => {
  it("refuses a note with no words", async () => {
    await expect(
      addNote({ entity: "deal", entityId: dealId, kind: "note", body: "   ", actorId: ACTOR }),
    ).rejects.toThrow(NoteRefused);
  });

  it("is refused by the DATABASE too", async () => {
    // The domain checks first so a person meets a sentence rather than a
    // five-hundred. The rule lives in the database as well, because an empty
    // row would sit on the timeline looking like something was said.
    await expect(
      db.insert(note).values({
        entity: "deal",
        entityId: dealId,
        kind: "note",
        body: "  \n ",
        authorId: ACTOR,
      }),
    ).rejects.toThrow();
  });

  it("refuses a note about an enquiry that does not exist", async () => {
    await expect(
      addNote({
        entity: "deal",
        entityId: "00000000-0000-0000-0000-000000000000",
        kind: "call",
        body: "anything",
        actorId: ACTOR,
      }),
    ).rejects.toThrow(NoteRefused);
  });

  it("keeps what was said word for word", async () => {
    const said =
      "They confirmed the office accepts deposits from 08:00.\nBring two sealed envelopes.";
    const id = await addNote({
      entity: "deal",
      entityId: dealId,
      kind: "call",
      body: `  ${said}  `,
      happenedAt: new Date("2026-08-18T14:12:00Z"),
      actorId: ACTOR,
    });
    made.push(id);

    const [row] = await db.select().from(note).where(eq(note.id, id)).limit(1);
    // Trimmed at the ends, untouched inside. A tidied note is somebody's later
    // summary of what was said.
    expect(row?.body).toBe(said);
    expect(row?.kind).toBe("call");
  });

  it("records when it HAPPENED, not when it was typed", async () => {
    const [row] = await db
      .select()
      .from(note)
      .where(eq(note.id, made[0] as string))
      .limit(1);
    // A call made in the car and written up that evening happened in the car.
    expect(row?.happenedAt?.toISOString()).toBe("2026-08-18T14:12:00.000Z");
    expect(row?.createdAt?.getTime()).toBeGreaterThan(row?.happenedAt?.getTime() as number);
  });

  it("puts the note on the timeline as the only row of its kind", async () => {
    const events = await timelineFor(dealId);
    const noted = events.filter((event) => event.side === "noted" && event.id.startsWith("note:"));
    expect(noted).toHaveLength(1);
    expect(noted[0]?.body).toContain("two sealed envelopes");
    expect(noted[0]?.at.toISOString()).toBe("2026-08-18T14:12:00.000Z");
  });

  it("logs which screen wrote it", async () => {
    const [entry] = await db
      .select()
      .from(auditEntry)
      .where(eq(auditEntry.entityId, made[0] as string))
      .limit(1);
    expect(entry?.sourceScreen).toBe("56");
    expect((entry?.after as Record<string, unknown> | undefined)?.about).toBe(`deal:${dealId}`);
  });
});

describe("a note with a date is what a task means", () => {
  it("does not appear as due when it carries no date", async () => {
    const mine = (await notesDue()).filter((row) => made.includes(row.id));
    expect(mine).toHaveLength(0);
  });

  it("appears as due once somebody sets one", async () => {
    const id = await addNote({
      entity: "deal",
      entityId: dealId,
      kind: "note",
      body: "Bring the two sealed envelopes to the DA office.",
      dueAt: "2026-08-20",
      actorId: ACTOR,
    });
    made.push(id);

    const mine = (await notesDue()).filter((row) => made.includes(row.id));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.dueAt.toISOString().slice(0, 10)).toBe("2026-08-20");
    expect(mine[0]?.entity).toBe("deal");
  });

  it("is read by Today from HERE, not copied into a second list", async () => {
    const mine = (await notesDue()).filter((row) => made.includes(row.id));
    const item = {
      id: `note:${mine[0]?.id}`,
      kind: "note" as const,
      title: mine[0]?.body ?? "",
      detail: "",
      href: "/",
      action: "open",
      expiresAt: mine[0]?.dueAt ?? null,
      amount: "0",
      waitingOnThem: false,
    };

    // On its day it is today's work...
    const onTheDay = today([item], new Date("2026-08-20T09:00:00Z"));
    expect(onTheDay.count).toBe(1);
    expect(onTheDay.bands[0]?.band).toBe("quick");

    // ...before its day it is not...
    expect(today([item], new Date("2026-08-18T09:00:00Z")).count).toBe(0);

    // ...and after its day it still is. Unlike a tender, a missed reminder is
    // not gone — it is simply late and still has to be done.
    expect(today([item], new Date("2026-08-25T09:00:00Z")).count).toBe(1);
  });

  it("drops out of what is due once it is marked done", async () => {
    const id = made[made.length - 1] as string;
    await db.update(note).set({ doneAt: new Date() }).where(eq(note.id, id));
    expect((await notesDue()).filter((row) => made.includes(row.id))).toHaveLength(0);
  });
});
