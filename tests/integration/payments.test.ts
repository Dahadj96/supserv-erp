import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { document } from "@/db/schema/document";
import { payment, paymentAllocation, relance } from "@/db/schema/money";
import { party, partyRole } from "@/db/schema/party";
import { ageingOf, balanceOf, isOverdue } from "@/domain/money/ageing";
import { collectionOf } from "@/domain/money/collection";
import { over90, paidStateOf } from "@/domain/money/invoices";
import { dueNow } from "@/domain/money/relance";
import {
  allocationsFor,
  billed,
  draftRelance,
  listPayments,
  markRelanceSent,
  owings,
  PaymentRefused,
  policy,
  receivedSince,
  recordPayment,
  recordReply,
  relancesFor,
  settlements,
  unallocated,
} from "@/domain/money/store";

/**
 * Phase 5's done-criteria against a real database: "proforma → invoice →
 * payment → statement runs without a spreadsheet, and 'overdue' is computed,
 * never stored."
 *
 * The parts that cannot be unit-tested are the ones checked here: that a
 * balance really does fall out of allocation rows, and that the database
 * refuses to let a 500 000 transfer settle 600 000 of invoices.
 */
const ACTOR = "test-payments-actor";
const stamp = Date.now().toString().slice(-5);

let clientId = "";
const invoices: string[] = [];
const payments: string[] = [];

const day = (m: number, d: number) =>
  `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const TODAY = new Date(Date.UTC(2026, 7, 18));

beforeAll(async () => {
  const [client] = await db
    .insert(party)
    .values({ code: `CL-T6${stamp}`, legalName: "TEST PAY URBACON", tradeName: "URBACON (UCC)" })
    .returning({ id: party.id });
  clientId = client?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });

  const made = await db
    .insert(document)
    .values([
      {
        kind: "invoice",
        number: `PAYT/${stamp}/0034`,
        partyId: clientId,
        locale: "fr",
        status: "issued",
        issuedOn: day(4, 12),
        dueOn: day(5, 12),
        totals: { totalIncl: "5640000" },
      },
      {
        kind: "invoice",
        number: `PAYT/${stamp}/0039`,
        partyId: clientId,
        locale: "fr",
        status: "issued",
        issuedOn: day(7, 28),
        dueOn: day(8, 27),
        totals: { totalIncl: "532520" },
      },
      // A draft. The client has never seen it, so nobody owes it (LAW 5).
      {
        kind: "invoice",
        number: null,
        partyId: clientId,
        locale: "fr",
        status: "draft",
        totals: { totalIncl: "999999" },
      },
    ])
    .returning({ id: document.id });
  invoices.push(...made.map((m) => m.id));
});

afterAll(async () => {
  if (payments.length) {
    await db.delete(paymentAllocation).where(inArray(paymentAllocation.paymentId, payments));
    await db.delete(payment).where(inArray(payment.id, payments));
  }
  await db.delete(relance).where(inArray(relance.documentId, invoices));
  await db.delete(document).where(inArray(document.id, invoices));
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  await db.delete(partyRole).where(eq(partyRole.partyId, clientId));
  await db.delete(party).where(eq(party.id, clientId));
});

const ours = async () => (await owings({ partyId: clientId })).filter((o) => o.number);

describe("what is owed", () => {
  it("leaves a draft invoice out — nobody owes what they have not seen", async () => {
    const ledger = await ours();
    expect(ledger).toHaveLength(2);
    expect(ledger.every((o) => o.number)).toBe(true);
  });

  it("computes the balance from allocations, with no column to disagree", async () => {
    const ledger = await ours();
    const big = ledger.find((o) => o.number?.endsWith("0034"));
    expect(balanceOf(big as never)).toBe("5640000.00");
    expect(isOverdue(big as never, TODAY)).toBe(true);
  });
});

describe("a payment arrives", () => {
  it("settles part of an invoice and the balance follows", async () => {
    const ledger = await ours();
    const big = ledger.find((o) => o.number?.endsWith("0034"));

    const id = await recordPayment({
      partyId: clientId,
      method: "virement",
      amount: "3000000",
      receivedOn: day(8, 14),
      bankRef: "VIR-2026-8891",
      allocations: { [big?.documentId as string]: "3000000" },
      actorId: ACTOR,
    });
    payments.push(id);

    const after = (await ours()).find((o) => o.number?.endsWith("0034"));
    expect(balanceOf(after as never)).toBe("2640000.00");
  });

  it("refuses to allocate more than the invoice still owes", async () => {
    // Two transfers of 3 000 000 against 5 640 000: the second may only take
    // 2 640 000. Offering the full amount would quietly create a credit
    // nobody asked for.
    const big = (await ours()).find((o) => o.number?.endsWith("0034"));
    await expect(
      recordPayment({
        partyId: clientId,
        method: "virement",
        amount: "3000000",
        receivedOn: day(8, 15),
        allocations: { [big?.documentId as string]: "3000000" },
        actorId: ACTOR,
      }),
    ).rejects.toThrow(PaymentRefused);
  });

  it("refuses to allocate more than the payment", async () => {
    const ledger = await ours();
    await expect(
      recordPayment({
        partyId: clientId,
        method: "cheque",
        amount: "500000",
        receivedOn: day(8, 15),
        allocations: {
          [ledger[0]?.documentId as string]: "300000",
          [ledger[1]?.documentId as string]: "300000",
        },
        actorId: ACTOR,
      }),
    ).rejects.toThrow(PaymentRefused);
  });

  it("is refused by the database too, not only by the domain", async () => {
    // The domain checks first so a person meets a sentence rather than a
    // five-hundred. But the rule lives in the database as well, because a
    // future screen that forgets to ask must not be able to invent money.
    const id = await recordPayment({
      partyId: clientId,
      method: "cheque",
      amount: "100000",
      receivedOn: day(8, 15),
      actorId: ACTOR,
    });
    payments.push(id);

    const ledger = await ours();
    await expect(
      db.insert(paymentAllocation).values({
        paymentId: id,
        documentId: ledger[0]?.documentId as string,
        amount: "150000",
      }),
    ).rejects.toThrow();
  });

  it("holds money nobody has assigned yet, and says how much", async () => {
    // An advance arrives before anyone knows which invoice it settles. That is
    // a real position the business holds, not an error.
    const held = Number(await unallocated(clientId));
    expect(held).toBeGreaterThanOrEqual(100000);
  });

  it("lists what arrived, newest first", async () => {
    const rows = await listPayments();
    const mine = rows.filter((r) => payments.includes(r.id));
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine[0]?.clientName).toBe("URBACON (UCC)");
  });

  it("refuses a payment of nothing", async () => {
    await expect(
      recordPayment({
        partyId: clientId,
        method: "especes",
        amount: "0",
        receivedOn: day(8, 15),
        actorId: ACTOR,
      }),
    ).rejects.toThrow(PaymentRefused);
  });
});

describe("the ageing report, from real rows", () => {
  it("puts the part-paid invoice in over-90 at its remaining balance", async () => {
    const ageing = ageingOf(await ours(), TODAY);
    // 5 640 000 less the 3 000 000 that arrived.
    expect(ageing.buckets.over90.amount).toBe("2640000.00");
    expect(ageing.buckets.d0_30.amount).toBe("532520.00");
    expect(ageing.total).toBe("3172520.00");
  });
});

describe("chasing, recorded rather than remembered", () => {
  it("seeds the policy so settings has something to edit", async () => {
    const steps = await policy();
    expect(steps.map((s) => s.key)).toEqual([
      "reminder1",
      "reminder2",
      "phone",
      "mise_en_demeure",
      "stop_offers",
    ]);
    // The one that always needs a person.
    expect(steps.find((s) => s.key === "mise_en_demeure")?.needsApproval).toBe(true);
  });

  it("drafts a chase and sends nothing", async () => {
    const big = (await ours()).find((o) => o.number?.endsWith("0034"));
    const id = await draftRelance({
      documentId: big?.documentId as string,
      stepKey: "reminder1",
      channel: "email",
      sentTo: "compta@urbacon-qa.test",
      actorId: ACTOR,
    });

    const history = await relancesFor([big?.documentId as string]);
    expect(history.get(big?.documentId as string)?.[0]).toMatchObject({
      id,
      status: "draft",
      sentAt: null,
    });

    // And the policy still says the step is due, because the client has heard
    // nothing — a draft is not a chase.
    const due = dueNow({
      dueOn: big?.dueOn ?? null,
      balance: balanceOf(big as never),
      policy: await policy(),
      history: history.get(big?.documentId as string) ?? [],
      today: TODAY,
    });
    expect(due?.step.key).toBe("reminder1");
    expect(due?.drafted).toBe(true);
  });

  it("moves on once a person says they sent it", async () => {
    const big = (await ours()).find((o) => o.number?.endsWith("0034"));
    const history = await relancesFor([big?.documentId as string]);
    const draft = history.get(big?.documentId as string)?.[0];

    await markRelanceSent({
      relanceId: draft?.id as string,
      when: new Date(Date.UTC(2026, 6, 15)),
      actorId: ACTOR,
    });

    const after = await relancesFor([big?.documentId as string]);
    const due = dueNow({
      dueOn: big?.dueOn ?? null,
      balance: balanceOf(big as never),
      policy: await policy(),
      history: after.get(big?.documentId as string) ?? [],
      today: TODAY,
    });
    expect(due?.step.key).toBe("reminder2");
  });

  it("treats a promised date as a fact about what was said, not a payment", async () => {
    const big = (await ours()).find((o) => o.number?.endsWith("0034"));
    const history = await relancesFor([big?.documentId as string]);
    const sent = history.get(big?.documentId as string)?.[0];

    await recordReply({
      relanceId: sent?.id as string,
      reply: "en cours de traitement — paiement semaine du 11",
      promisedOn: day(8, 25),
      actorId: ACTOR,
    });

    const after = await relancesFor([big?.documentId as string]);
    // The policy stays quiet until the promised date passes...
    expect(
      dueNow({
        dueOn: big?.dueOn ?? null,
        balance: balanceOf(big as never),
        policy: await policy(),
        history: after.get(big?.documentId as string) ?? [],
        today: TODAY,
      }),
    ).toBeNull();

    // ...and the balance has not moved a centime. A promise is not money.
    expect(balanceOf(big as never)).toBe("2640000.00");
  });

  it("will not chase an invoice the client has never seen", async () => {
    const draftInvoice = invoices[2] as string;
    await expect(
      draftRelance({ documentId: draftInvoice, stepKey: null, channel: "email", actorId: ACTOR }),
    ).rejects.toThrow(PaymentRefused);
  });
});

/**
 * Screen 19's own queries.
 *
 * `settlements()` is the one worth a real database: it is a join and a group
 * by, written that way because drizzle renders a `sql` template's table
 * reference without correlating it. That bug returned 0 silently in
 * `requestsForDeal`, and silently is the problem — nought days to pay reads as
 * *this client pays instantly*, which is the opposite of what it means.
 */
describe("what screen 19 asks the database", () => {
  it("names the invoices one payment settled, without repeating the payment", async () => {
    const rows = await listPayments();
    const mine = rows.filter((r) => payments.includes(r.id));
    const against = await allocationsFor(mine.map((r) => r.id));

    const transfer = mine.find((r) => r.bankRef === "VIR-2026-8891");
    expect(against.get(transfer?.id as string)).toHaveLength(1);
    expect(against.get(transfer?.id as string)?.[0]?.number).toMatch(/0034$/);
    expect(against.get(transfer?.id as string)?.[0]?.amount).toBe("3000000.00");

    // The cheque was never assigned to anything, and that is a real state.
    const cheque = mine.find((r) => r.method === "cheque");
    expect(against.get(cheque?.id as string)).toBeUndefined();
  });

  it("does not call a part-paid invoice settled", async () => {
    const rows = (await settlements()).filter((s) => invoices.includes(s.documentId));
    const big = rows.find((s) => s.documentId === invoices[0]);
    // 3 000 000 of 5 640 000 has arrived. A deposit is not a settlement, and
    // dating this at the deposit would report a 124-day payer as a 4-day one.
    expect(big?.settledOn).toBeNull();
    expect(big?.issuedOn?.toISOString().slice(0, 10)).toBe("2026-04-12");
  });

  it("dates a settlement at the last payment that cleared it", async () => {
    const small = invoices[1] as string;
    const id = await recordPayment({
      partyId: clientId,
      method: "virement",
      amount: "532520",
      receivedOn: day(8, 16),
      bankRef: "VIR-2026-8902",
      allocations: { [small]: "532520" },
      actorId: ACTOR,
    });
    payments.push(id);

    const rows = (await settlements()).filter((s) => s.documentId === small);
    expect(rows[0]?.settledOn?.toISOString().slice(0, 10)).toBe("2026-08-16");

    // And it drops out of what is owed, rather than sitting there as a zero.
    expect((await ours()).filter((o) => Number(balanceOf(o)) > 0)).toHaveLength(1);
  });

  it("counts a draft invoice in neither place", async () => {
    const rows = await settlements();
    expect(rows.some((s) => s.documentId === invoices[2])).toBe(false);
  });

  it("reads the quarter from the day the money moved", async () => {
    const july = await receivedSince(day(7, 1));
    const august = await receivedSince(day(8, 16));
    // Every payment here arrived in August, so the quarter and the narrower
    // window differ only by the two recorded before the 16th.
    expect(july.length).toBeGreaterThanOrEqual(august.length + 2);
    expect(august.every((r) => r.currency === "DZD")).toBe(true);
  });

  it("feeds the quarter-to-date card from those rows", async () => {
    const card = collectionOf({
      received: await receivedSince(day(7, 1)),
      stillToCollect: ageingOf(await ours(), TODAY).total,
      settlements: (await settlements()).filter((s) => invoices.includes(s.documentId)),
      today: TODAY,
    });
    // One client, so no best and no worst — there is just the client.
    expect(card.best).toBeNull();
    expect(card.worst).toBeNull();
    // Two invoices: one settled in 19 days, one still running at 128.
    expect(card.stillRunning).toBe(1);
    expect(card.averageDaysToPay).toBe(74);
    expect(card.stillToCollect).toBe("2640000.00");
  });
});

/**
 * Screen 17's table, once payments exist.
 *
 * `billed()` is deliberately wider than `owings()`: it keeps drafts and
 * proformas, because the question is "what have we billed" rather than "what is
 * owed". What each row IS falls out of `paidStateOf` over the allocations, not
 * out of `document.status`.
 */
describe("what screen 17 shows", () => {
  it("keeps the draft that owings() drops", async () => {
    const mine = (await billed()).filter((r) => invoices.includes(r.documentId));
    expect(mine).toHaveLength(3);
    expect((await ours()).length).toBe(2);
  });

  it("derives paid, part-paid and draft from the rows, not from a status column", async () => {
    const mine = (await billed()).filter((r) => invoices.includes(r.documentId));
    const state = (id: string) => paidStateOf(mine.find((r) => r.documentId === id) as never);

    // 3 000 000 of 5 640 000 has arrived...
    expect(state(invoices[0] as string)).toBe("partPaid");
    // ...this one was settled in full...
    expect(state(invoices[1] as string)).toBe("paid");
    // ...and nobody has ever seen this one.
    expect(state(invoices[2] as string)).toBe("draft");

    // Every one of those documents still says `issued` or `draft` in the
    // database. Nothing fired a transition, and nothing had to.
    const stored = mine.map((r) => r.status).sort();
    expect(stored).toEqual(["draft", "issued", "issued"]);
  });

  it("has no object to show when the document has no lines", async () => {
    const mine = (await billed()).filter((r) => invoices.includes(r.documentId));
    // Derived from the first line, so a header with no lines says nothing
    // rather than inventing a subject.
    expect(mine.every((r) => r.object === null)).toBe(true);
  });

  it("hands the banner the same figures screen 20 buckets", async () => {
    const ledger = await ours();
    const banner = over90(ledger, TODAY);
    // Only the April invoice is past ninety days, at its remaining balance.
    expect(banner?.invoices).toBe(1);
    expect(banner?.amount).toBe("2640000.00");
    expect(banner?.clients).toEqual(["URBACON (UCC)"]);
  });
});
