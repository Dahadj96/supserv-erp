import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { bankAccount, COMPANY_ID, companyIdentity, vatRate } from "@/db/schema/company";
import { auditEntry } from "@/db/schema/control";
import { document, documentLine, documentLink, numberingSeries } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import { ensureRulesExist } from "@/documents/compliance";
import { CannotCredit, cancelByCreditNote, cancelState, mayCredit } from "@/documents/credit";
import { render } from "@/documents/engine";
import { saveIdentity, setLogo } from "@/domain/company";
import { computeTotals } from "@/domain/money";
import { ageingOf, balanceOf } from "@/domain/money/ageing";
import { paidStateOf } from "@/domain/money/invoices";
import { billed, owings } from "@/domain/money/store";

/**
 * CLAUDE.md, THE THIRD OF THE FIVE TESTS THAT MATTER.
 *
 *   "A number is never reused — issue three, cancel the second, issue a
 *    fourth. The series reads 0001–0004 and 0002 is an avoir. Assert in the
 *    database."
 *
 * It could not be written before 8 September 2026 because there was no way to
 * cancel anything: `invoices.cancel` was granted to the Gérant and referenced
 * exactly once in the repository — its own declaration — and `credited` was on
 * `MACHINES.document.unwritten`.
 *
 * ASSERTED IN THE DATABASE, as the sentence says, and that phrase is doing
 * work. Every claim below is read back out of Postgres rather than off the
 * value a function returned: the four numbers come from the `document` rows,
 * the link comes from `document_link`, and the promise that a number is never
 * reused is tested by ASKING THE DATABASE TO REUSE ONE and being refused.
 */
const ACTOR = "test-avoir-actor";

/**
 * The real kinds. `invoice` and `credit_note`, not `test_invoice` — the
 * compliance rules are keyed on `invoice.*` and an invented kind would match
 * none of them, so the test would pass while proving nothing. Whatever the two
 * series were configured as is snapshotted and put back, byte for byte.
 */
const KIND = "invoice";
const AVOIR = "credit_note";
const PATTERN = "SUPAT3/{YYYY}/{####}";
const AVOIR_PATTERN = "AVAT3/{YYYY}/{####}";

const IDENTITY = {
  legalName: "SARL SUPSERV (TEST AVOIR)",
  tradeName: "",
  legalForm: "SARL",
  capital: "",
  rc: "01/00-7654321 B 15",
  nif: "000116007654321",
  nis: "000116007654321001",
  ai: "16050654321",
  address: "Zone industrielle, Adrar",
  wilaya: "Adrar",
  phone: "",
  email: "",
  website: "",
};

let previousIdentity: typeof companyIdentity.$inferSelect | undefined;
let previousSeries: typeof numberingSeries.$inferSelect | undefined;
let previousAvoirSeries: typeof numberingSeries.$inferSelect | undefined;
let clientId: string;
/**
 * A SECOND client, for the money block alone.
 *
 * `owings()` answers per party, and the four invoices the acceptance test
 * leaves standing are owed by the first one. Netting a credited invoice out of
 * an ageing report that already carries three unrelated ones would prove
 * nothing about the netting.
 */
let moneyClientId: string;
const docIds: string[] = [];

/** The four digits at the end. The whole test is about those. */
const tail = (number: string | null) => (number ?? "").slice(-4);

async function draftInvoice(total: string, partyId = clientId): Promise<string> {
  const lines = [{ qty: "1", unitPrice: total, vatRate: "0" }];
  const [row] = await db
    .insert(document)
    .values({
      kind: KIND,
      partyId,
      locale: "fr",
      currency: "DZD",
      status: "draft",
      issuedOn: "2026-09-08",
      dueOn: "2026-10-08",
      // Not cash: the droit de timbre rule is one of the four waiting on the
      // accountant, and this test is about numbering, not about that.
      settlement: "virement",
      totals: computeTotals(lines),
    })
    .returning({ id: document.id });

  const id = row?.id as string;
  docIds.push(id);

  await db.insert(documentLine).values({
    documentId: id,
    position: 1,
    lineKind: "item",
    designation: "Câble U1000 R2V 4G16",
    unit: "ML",
    qty: "1.0000",
    unitPrice: total,
    vatRate: "0.00",
    totalExcl: total,
  });

  return id;
}

async function issue(id: string): Promise<string | null> {
  const out = await render({ documentId: id, purpose: "issue", actorId: ACTOR });
  return out.number;
}

beforeAll(async () => {
  [previousIdentity] = await db
    .select()
    .from(companyIdentity)
    .where(eq(companyIdentity.id, COMPANY_ID));

  await saveIdentity(IDENTITY, ACTOR);
  await setLogo("company/logo-test-avoir.png", ACTOR);
  await ensureRulesExist();

  [previousSeries] = await db.select().from(numberingSeries).where(eq(numberingSeries.kind, KIND));
  [previousAvoirSeries] = await db
    .select()
    .from(numberingSeries)
    .where(eq(numberingSeries.kind, AVOIR));

  await db.delete(numberingSeries).where(inArray(numberingSeries.kind, [KIND, AVOIR]));
  await db.insert(numberingSeries).values([
    { kind: KIND, pattern: PATTERN, reset: "yearly", nextValue: 1 },
    { kind: AVOIR, pattern: AVOIR_PATTERN, reset: "yearly", nextValue: 1 },
  ]);

  await db.delete(vatRate).where(like(vatRate.authority, "TESTAV %"));
  await db
    .insert(vatRate)
    .values({ rate: "19.000", kind: "normal", startsOn: "2017-01-01", authority: "TESTAV lf2017" });

  await db.delete(bankAccount).where(like(bankAccount.bankName, "TESTAV %"));
  await db
    .insert(bankAccount)
    .values({ bankName: "TESTAV BEA", rib: "00300987654321098765", isDefault: false });

  await db.delete(party).where(inArray(party.code, ["TEST-AVOIR-CLIENT", "TEST-AVOIR-MONEY"]));
  const made = await db
    .insert(party)
    .values([
      {
        code: "TEST-AVOIR-CLIENT",
        legalName: "ENTREPRISE TEST AVOIR",
        nif: "000116009999999",
        address: "Adrar",
        docLocale: "fr",
      },
      {
        code: "TEST-AVOIR-MONEY",
        legalName: "ENTREPRISE TEST AVOIR (SOLDE)",
        nif: "000116009999998",
        address: "Adrar",
        docLocale: "fr",
      },
    ])
    .returning({ id: party.id });
  clientId = made[0]?.id as string;
  moneyClientId = made[1]?.id as string;
});

afterAll(async () => {
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  if (docIds.length) {
    await db.delete(documentLink).where(inArray(documentLink.fromDocument, docIds));
    await db.delete(documentLink).where(inArray(documentLink.toDocument, docIds));
    await db.delete(documentLine).where(inArray(documentLine.documentId, docIds));
    await db.delete(document).where(inArray(document.id, docIds));
  }
  await db.delete(numberingSeries).where(inArray(numberingSeries.kind, [KIND, AVOIR]));
  if (previousSeries) await db.insert(numberingSeries).values(previousSeries);
  if (previousAvoirSeries) await db.insert(numberingSeries).values(previousAvoirSeries);
  await db.delete(vatRate).where(like(vatRate.authority, "TESTAV %"));
  await db.delete(bankAccount).where(like(bankAccount.bankName, "TESTAV %"));
  await db.delete(party).where(inArray(party.code, ["TEST-AVOIR-CLIENT", "TEST-AVOIR-MONEY"]));
  if (previousIdentity) {
    await db
      .update(companyIdentity)
      .set(previousIdentity)
      .where(eq(companyIdentity.id, COMPANY_ID));
  } else {
    await db.delete(companyIdentity).where(eq(companyIdentity.id, COMPANY_ID));
  }
});

describe("acceptance test 3 — a number is never reused", () => {
  const invoices: string[] = [];
  let creditNoteId: string;

  it("issues three, cancels the second, issues a fourth", async () => {
    for (const total of ["100000.00", "200000.00", "300000.00"]) {
      invoices.push(await draftInvoice(total));
    }
    const first = await issue(invoices[0] as string);
    const second = await issue(invoices[1] as string);
    const third = await issue(invoices[2] as string);
    expect([tail(first), tail(second), tail(third)]).toEqual(["0001", "0002", "0003"]);

    const cancelled = await cancelByCreditNote({
      documentId: invoices[1] as string,
      reason: "Erreur de quantité — la facture est annulée et refaite.",
      issuedOn: "2026-09-08",
      actorId: ACTOR,
    });
    creditNoteId = cancelled.creditNoteId;
    docIds.push(creditNoteId);

    const fourth = await draftInvoice("400000.00");
    invoices.push(fourth);
    expect(tail(await issue(fourth))).toBe("0004");
  });

  it("the series reads 0001–0004 in the database, with no gap and no repeat", async () => {
    const rows = await db
      .select({ id: document.id, number: document.number, status: document.status })
      .from(document)
      .where(and(eq(document.kind, KIND), eq(document.partyId, clientId)))
      .orderBy(document.number);

    expect(rows.map((r) => tail(r.number))).toEqual(["0001", "0002", "0003", "0004"]);
    // Four rows, four distinct numbers. A cancelled invoice does not give its
    // number back, and the fourth does not take it.
    expect(new Set(rows.map((r) => r.number)).size).toBe(4);
  });

  it("0002 is credited, keeps its number, its lines and its lock", async () => {
    const [row] = await db
      .select()
      .from(document)
      .where(eq(document.id, invoices[1] as string));

    expect(row?.status, "the one word that changed").toBe("credited");
    expect(tail(row?.number ?? null), "and the number did not").toBe("0002");
    expect(row?.lockedAt, "LAW 5 — still frozen").not.toBeNull();
    expect(row?.totals, "the figures are the figures it was issued with").toEqual(
      computeTotals([{ qty: "1", unitPrice: "200000.00", vatRate: "0" }]),
    );

    const lines = await db
      .select()
      .from(documentLine)
      .where(eq(documentLine.documentId, invoices[1] as string));
    expect(lines, "nothing was edited and nothing was deleted").toHaveLength(1);
    expect(lines[0]?.unitPrice).toBe("200000.0000");
  });

  it("0002 is an avoir — a second document, with its own number in its own series", async () => {
    const [avoir] = await db.select().from(document).where(eq(document.id, creditNoteId));

    expect(avoir?.kind).toBe("credit_note");
    expect(avoir?.status).toBe("issued");
    expect(avoir?.lockedAt).not.toBeNull();
    // Its own series, not the invoice register: AVAT3/2026/0001, not 0005.
    expect(avoir?.number).toBe("AVAT3/2026/0001");

    const [series] = await db
      .select()
      .from(numberingSeries)
      .where(eq(numberingSeries.id, avoir?.seriesId as string));
    expect(series?.kind, "the avoir was numbered out of the avoir series").toBe(AVOIR);

    // The invoice series moved by exactly four — the avoir cost it nothing.
    const [invoiceSeries] = await db
      .select()
      .from(numberingSeries)
      .where(eq(numberingSeries.kind, KIND));
    expect(invoiceSeries?.nextValue).toBe(5);
  });

  it("the two documents name each other, in one row of document_link", async () => {
    const links = await db
      .select()
      .from(documentLink)
      .where(eq(documentLink.toDocument, invoices[1] as string));

    expect(links).toHaveLength(1);
    expect(links[0]?.relation).toBe("credits");
    expect(links[0]?.fromDocument).toBe(creditNoteId);

    // And both screens read it, each from its own end.
    const onInvoice = await cancelState(invoices[1] as string);
    expect(onInvoice.creditNote?.id).toBe(creditNoteId);
    const onAvoir = await cancelState(creditNoteId);
    expect(tail(onAvoir.cancels?.number ?? null)).toBe("0002");
  });

  it("prints the reason on the avoir, and keeps it in the audit trail", async () => {
    const lines = await db
      .select()
      .from(documentLine)
      .where(eq(documentLine.documentId, creditNoteId))
      .orderBy(documentLine.position);

    // The reason first, then the invoice's own lines, restated.
    expect(lines[0]?.lineKind).toBe("text");
    expect(lines[0]?.designation).toContain("Erreur de quantité");
    expect(lines).toHaveLength(2);
    expect(lines[1]?.unitPrice).toBe("200000.0000");

    const entries = await db
      .select()
      .from(auditEntry)
      .where(eq(auditEntry.entityId, invoices[1] as string));
    const credited = entries.find((entry) => entry.action === "credit");
    expect(credited?.reason).toContain("Erreur de quantité");
    expect((credited?.after as { creditNote?: string })?.creditNote).toBe(creditNoteId);
    // The entry says the number stayed, because that is what somebody will
    // actually ask this log two years from now.
    expect(tail((credited?.after as { number?: string })?.number ?? null)).toBe("0002");
  });

  it("the database itself refuses to reuse a number", async () => {
    // Not the application. `document_kind_number_once` is a partial unique
    // index and it is the half of LAW 5 that survives somebody writing a new
    // query. Reissuing 0002 under a new row is exactly what a person trying to
    // "redo" a cancelled invoice would attempt.
    const duplicate = db.insert(document).values({
      kind: KIND,
      partyId: clientId,
      locale: "fr",
      status: "issued",
      number: `SUPAT3/2026/0002`,
      issuedOn: "2026-09-09",
      totals: {},
    });
    await expect(duplicate).rejects.toThrow();
  });

  it("the database itself refuses to change an issued document", async () => {
    // LAW 5: "enforce this with database triggers, not application code."
    // Before migration 0053 every one of these went through — the guards were
    // all in TypeScript, and a new `db.update(document)` anywhere bypassed
    // them. This is the trigger, tested the only way a trigger can be.
    const id = invoices[0] as string;

    await expect(
      db.update(document).set({ number: "SUPAT3/2026/9999" }).where(eq(document.id, id)),
    ).rejects.toThrow();

    await expect(
      db
        .update(document)
        .set({ totals: { totalIncl: "1.00" } })
        .where(eq(document.id, id)),
    ).rejects.toThrow();

    // And an issued document never goes in the thirty-day bin.
    await expect(
      db.update(document).set({ deletedAt: new Date() }).where(eq(document.id, id)),
    ).rejects.toThrow();

    // There is no road back to draft, from the database's point of view either.
    await expect(
      db.update(document).set({ status: "draft" }).where(eq(document.id, id)),
    ).rejects.toThrow();

    const [row] = await db.select().from(document).where(eq(document.id, id));
    expect(tail(row?.number ?? null)).toBe("0001");
    expect(row?.status).toBe("issued");
    expect(row?.deletedAt).toBeNull();
  });
});

describe("the money nets out", () => {
  const invoices: string[] = [];

  beforeAll(async () => {
    for (const total of ["50000.00", "60000.00"]) {
      const id = await draftInvoice(total, moneyClientId);
      invoices.push(id);
      await issue(id);
    }
    const { creditNoteId } = await cancelByCreditNote({
      documentId: invoices[1] as string,
      reason: "Facturée deux fois.",
      issuedOn: "2026-09-08",
      actorId: ACTOR,
    });
    docIds.push(creditNoteId);
  });

  it("a credited invoice stops being owed, over the real owings query", async () => {
    const rows = await owings({ partyId: moneyClientId });
    const ids = rows.map((row) => row.documentId);

    expect(ids, "the live one is still owed").toContain(invoices[0]);
    expect(ids, "the credited one is not").not.toContain(invoices[1]);
  });

  it("the avoir is not a debt in the other direction either", async () => {
    // `owings` reads INVOICE_KINDS, and `credit_note` is deliberately not one
    // of them. An avoir asks nobody for money — it says a demand was
    // withdrawn — so it appears on screen 17 (what we have billed) and never
    // on screens 19 and 20 (what is owed). The alternative, a negative row in
    // the ageing report, would net out on the total and be unreadable on every
    // line: nobody chases minus 60 000.
    const rows = await owings({ partyId: moneyClientId });
    const kinds = await db
      .select({ id: document.id, kind: document.kind })
      .from(document)
      .where(
        inArray(
          document.id,
          rows.map((r) => r.documentId),
        ),
      );
    expect(kinds.every((row) => row.kind !== "credit_note")).toBe(true);
  });

  it("the ageing report counts the live invoice once, not the pair", async () => {
    const rows = await owings({ partyId: moneyClientId });
    const report = ageingOf(rows, new Date("2026-09-20T00:00:00Z"));

    // Two invoices raised in this block, one cancelled. Neither the 60 000 nor
    // a minus 60 000 may reach this figure: it is 50 000 and nothing else.
    expect(report.total).toBe("50000.00");
    expect(report.invoices).toBe(1);
    expect(report.byClient[0]?.amount).toBe("50000.00");

    // And the balance function, on its own, agrees.
    const live = rows.find((row) => row.documentId === invoices[0]);
    expect(balanceOf(live as NonNullable<typeof live>)).toBe("50000.00");
  });

  it("screen 17 still shows both papers, and says what each one is", async () => {
    // Stopping being owed is not disappearing. A credited invoice and its
    // avoir are both on the invoices list — that is the whole of "nothing
    // disappears" — and the Status column is what tells them apart.
    const rows = (await billed()).filter((row) => row.partyId === moneyClientId);

    const credited = rows.find((row) => row.documentId === invoices[1]);
    expect(credited, "the cancelled invoice is still listed").toBeDefined();
    expect(paidStateOf(credited as NonNullable<typeof credited>)).toBe("credited");

    const avoirs = rows.filter((row) => row.kind === "credit_note");
    expect(avoirs.length).toBeGreaterThan(0);
    expect(avoirs.every((row) => row.number !== null)).toBe(true);
  });
});

describe("what it refuses, and why", () => {
  it("refuses an avoir with no reason", async () => {
    const id = await draftInvoice("10000.00");
    await issue(id);
    await expect(
      cancelByCreditNote({ documentId: id, reason: "   ", actorId: ACTOR }),
    ).rejects.toMatchObject({ why: "reasonRequired" });

    // And nothing was written: no avoir, no link, no number spent.
    const links = await db.select().from(documentLink).where(eq(documentLink.toDocument, id));
    expect(links).toHaveLength(0);
  });

  it("refuses a draft — there is nothing to cancel until a client has it", async () => {
    const id = await draftInvoice("11000.00");
    await expect(
      cancelByCreditNote({ documentId: id, reason: "Erreur.", actorId: ACTOR }),
    ).rejects.toMatchObject({ why: "notIssued" });
  });

  it("refuses a second avoir on the same invoice", async () => {
    const id = await draftInvoice("12000.00");
    await issue(id);
    const first = await cancelByCreditNote({
      documentId: id,
      reason: "Client a annulé la commande.",
      actorId: ACTOR,
    });
    docIds.push(first.creditNoteId);

    await expect(
      cancelByCreditNote({ documentId: id, reason: "Encore une fois.", actorId: ACTOR }),
    ).rejects.toBeInstanceOf(CannotCredit);

    const links = await db.select().from(documentLink).where(eq(documentLink.toDocument, id));
    expect(links, "one invoice, one avoir").toHaveLength(1);
  });

  it("refuses a kind the catalogue does not credit, and says so on the screen", async () => {
    expect(mayCredit("invoice")).toBe(true);
    expect(mayCredit("credit_note")).toBe(false);
    expect(mayCredit("delivery_note")).toBe(false);
    expect(mayCredit("quotation")).toBe(false);

    const [row] = await db
      .insert(document)
      .values({
        kind: "delivery_note",
        partyId: clientId,
        locale: "fr",
        status: "issued",
        number: `BLAT3-2026-0001`,
        issuedOn: "2026-09-08",
        lockedAt: new Date("2026-09-08T09:00:00Z"),
        totals: {},
      })
      .returning({ id: document.id });
    const id = row?.id as string;
    docIds.push(id);

    await expect(
      cancelByCreditNote({ documentId: id, reason: "Erreur.", actorId: ACTOR }),
    ).rejects.toMatchObject({ why: "kindCannotBeCredited" });

    const state = await cancelState(id);
    expect(state.creditable).toBe(false);
    expect(state.issued).toBe(true);
  });
});
