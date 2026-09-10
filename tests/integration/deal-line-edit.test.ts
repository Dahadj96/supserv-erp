import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine, priceQuote } from "@/db/schema/deal";
import { item } from "@/db/schema/item";
import { party, partyRole } from "@/db/schema/party";
import { createDeal, recordLost } from "@/domain/deal/deal";
import { editLines, type LineEdit, LinesRefused } from "@/domain/deal/lines";
import { addQuote } from "@/domain/deal/price-store";

/**
 * Screen 73 — correcting the item list one field at a time.
 *
 * "The list is not editable. There's no way to save it. There's no way to
 * delete it. There's no way to correct something." That was the report on the
 * textarea this replaced, and every clause of it was true.
 *
 * What is tested here is the part a person cannot see and would feel three days
 * later: A CORRECTED LINE IS STILL THE SAME LINE. `replaceLines` deletes every
 * row and writes new ones, which is right for a paste and wrong for an edit —
 * on an edit it cuts loose the shop-counter price captured against line 1 and
 * the catalogue item somebody matched it to, because the row they hung off no
 * longer exists.
 */

const ACTOR = "test-line-edit-actor";
const stamp = Date.now().toString().slice(-6);

let clientId = "";
let itemId = "";
const made: string[] = [];

beforeAll(async () => {
  const [client] = await db
    .insert(party)
    .values({
      code: `CL-E9${stamp.slice(-5)}`,
      legalName: `GROUPEMENT EDIT ${stamp}`,
    })
    .returning({ id: party.id });
  clientId = client?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });

  const [catalogue] = await db
    .insert(item)
    .values({ code: `ART-E${stamp}`, designation: "Vanne papillon DN80 PN16", kind: "good" })
    .returning({ id: item.id });
  itemId = catalogue?.id as string;
});

afterAll(async () => {
  if (made.length > 0) {
    await db.delete(priceQuote).where(inArray(priceQuote.dealId, made));
    await db.delete(dealLine).where(inArray(dealLine.dealId, made));
    await db.delete(deal).where(inArray(deal.id, made));
  }
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  if (itemId) await db.delete(item).where(eq(item.id, itemId));
  if (clientId) {
    await db.delete(partyRole).where(eq(partyRole.partyId, clientId));
    await db.delete(party).where(eq(party.id, clientId));
  }
});

async function enquiry(subject: string): Promise<string> {
  const id = await createDeal(
    {
      partyId: clientId,
      subject,
      contactPersonId: null,
      clientReference: null,
      receivedAt: new Date(),
      deadlineAt: null,
      submissionMethod: "email",
      currency: "DZD",
      ownerId: null,
      source: "manual",
      intakeMessageId: null,
      expectedValue: null,
      clientInstructions: null,
    },
    ACTOR,
  );
  made.push(id);
  return id;
}

const row = (over: Partial<LineEdit> = {}): LineEdit => ({
  id: null,
  reference: null,
  designation: "Ligne",
  qty: "1",
  unit: "U",
  ...over,
});

async function linesOf(dealId: string) {
  return db
    .select()
    .from(dealLine)
    .where(eq(dealLine.dealId, dealId))
    .orderBy(asc(dealLine.position));
}

describe("correcting a line rather than replacing the list", () => {
  it("keeps the catalogue match and the price when a quantity is corrected", async () => {
    const dealId = await enquiry("Vannes et raccords");

    await editLines({
      dealId,
      actorId: ACTOR,
      rows: [
        row({ reference: "VP-80", designation: "Vanne papillon DN80", qty: "12" }),
        row({ designation: "Raccord bride 2 pouces", qty: "40" }),
      ],
    });

    const before = await linesOf(dealId);
    const first = before[0];
    expect(first).toBeTruthy();

    // Somebody matched it to the catalogue, and somebody else walked into a
    // shop in Adrar and wrote down what it costs. Both hang off this row.
    await db
      .update(dealLine)
      .set({ itemId, matchedBy: "typed" })
      .where(eq(dealLine.id, first?.id as string));
    const quoteId = await addQuote({
      dealId,
      dealLineId: first?.id as string,
      source: "shop_visit",
      supplierName: "Ets Chergui, Adrar",
      price: "21400",
      currency: "DZD",
      isExclVat: true,
      isVerbal: true,
      validUntil: null,
      capturedPlace: "Ets Chergui, Adrar",
      capturedFrom: "le vendeur",
      actorId: ACTOR,
    });

    // The client rings: it is twenty, not twelve.
    const report = await editLines({
      dealId,
      actorId: ACTOR,
      rows: [
        row({
          id: first?.id ?? null,
          reference: "VP-80",
          designation: "Vanne papillon DN80",
          qty: "20",
        }),
        row({ id: before[1]?.id ?? null, designation: "Raccord bride 2 pouces", qty: "40" }),
      ],
    });

    expect(report).toEqual({ kept: 2, added: 0, removed: 0 });

    const after = await linesOf(dealId);
    expect(after[0]?.id).toBe(first?.id);
    expect(Number(after[0]?.qty)).toBe(20);
    // The two things a delete-and-reinsert would have thrown away.
    expect(after[0]?.itemId).toBe(itemId);
    expect(after[0]?.matchedBy).toBe("typed");

    const [quote] = await db.select().from(priceQuote).where(eq(priceQuote.id, quoteId));
    expect(quote?.dealLineId).toBe(first?.id);
  });

  it("adds, deletes and reorders in one save, and renumbers from one", async () => {
    const dealId = await enquiry("Trois lignes");

    await editLines({
      dealId,
      actorId: ACTOR,
      rows: [
        row({ designation: "Première" }),
        row({ designation: "Deuxième" }),
        row({ designation: "Troisième" }),
      ],
    });
    const before = await linesOf(dealId);

    /*
      The swap is the case that broke Postgres before the positions were parked
      on negatives first: `deal_line_position` is a unique index and it is
      checked row by row, so setting line 2 to position 1 is refused while line
      1 still holds it.
    */
    const report = await editLines({
      dealId,
      actorId: ACTOR,
      rows: [
        row({ id: before[1]?.id ?? null, designation: "Deuxième" }),
        row({ id: before[0]?.id ?? null, designation: "Première" }),
        row({ designation: "Quatrième" }),
      ],
    });

    expect(report).toEqual({ kept: 2, added: 1, removed: 1 });

    const after = await linesOf(dealId);
    expect(after.map((l) => l.position)).toEqual([1, 2, 3]);
    expect(after.map((l) => l.designation)).toEqual(["Deuxième", "Première", "Quatrième"]);
    // The two that survived are the same rows, moved — not new ones.
    expect(after[0]?.id).toBe(before[1]?.id);
    expect(after[1]?.id).toBe(before[0]?.id);
  });

  it("drops a row nobody filled in rather than refusing the whole save", async () => {
    const dealId = await enquiry("Une ligne vide");

    const report = await editLines({
      dealId,
      actorId: ACTOR,
      rows: [row({ designation: "Câble U1000 R2V 3G2.5" }), row({ designation: "   " })],
    });

    expect(report.added).toBe(1);
    expect(await linesOf(dealId)).toHaveLength(1);
  });

  it("lets the list be emptied, which the paste box never could", async () => {
    const dealId = await enquiry("À vider");
    await editLines({ dealId, actorId: ACTOR, rows: [row({ designation: "Une ligne" })] });

    const report = await editLines({ dealId, actorId: ACTOR, rows: [] });

    expect(report).toEqual({ kept: 0, added: 0, removed: 1 });
    expect(await linesOf(dealId)).toHaveLength(0);
  });

  it("reads a quantity the way the paste reader does", async () => {
    const dealId = await enquiry("Virgule décimale");

    await editLines({
      dealId,
      actorId: ACTOR,
      // Typed by somebody with a French keyboard, into a box labelled Qty.
      rows: [row({ designation: "Câble", qty: "2,5", unit: "ml" })],
    });

    const [line] = await linesOf(dealId);
    expect(Number(line?.qty)).toBe(2.5);
  });
});

describe("what it refuses", () => {
  it("refuses a quantity that is not a number, and changes nothing", async () => {
    const dealId = await enquiry("Quantité illisible");
    await editLines({ dealId, actorId: ACTOR, rows: [row({ designation: "Une ligne" })] });

    await expect(
      editLines({
        dealId,
        actorId: ACTOR,
        rows: [row({ designation: "Une ligne", qty: "douze" })],
      }),
    ).rejects.toMatchObject({ reason: "badQty" });

    // Refused BEFORE the transaction, so the list is still the list.
    expect(await linesOf(dealId)).toHaveLength(1);
  });

  it("refuses a quantity of zero", async () => {
    const dealId = await enquiry("Zéro");
    await expect(
      editLines({ dealId, actorId: ACTOR, rows: [row({ designation: "Une ligne", qty: "0" })] }),
    ).rejects.toBeInstanceOf(LinesRefused);
  });

  it("refuses to edit a lost enquiry", async () => {
    const dealId = await enquiry("Perdue");
    await recordLost({ dealId, reason: "Le client a choisi quelqu'un d'autre", actorId: ACTOR });

    await expect(
      editLines({ dealId, actorId: ACTOR, rows: [row({ designation: "Trop tard" })] }),
    ).rejects.toMatchObject({ reason: "closed" });
  });

  it("treats an id that is not on this deal as a new row", async () => {
    const a = await enquiry("Affaire A");
    const b = await enquiry("Affaire B");

    await editLines({ dealId: a, actorId: ACTOR, rows: [row({ designation: "La ligne de A" })] });
    const [ofA] = await linesOf(a);

    // An id in a form field is a number a person can change. Saving B's list
    // with A's line id must not reach across and rewrite A.
    await editLines({
      dealId: b,
      actorId: ACTOR,
      rows: [row({ id: ofA?.id ?? null, designation: "Volée à A" })],
    });

    const [stillA] = await linesOf(a);
    expect(stillA?.designation).toBe("La ligne de A");
    const [ofB] = await linesOf(b);
    expect(ofB?.id).not.toBe(ofA?.id);
  });
});
