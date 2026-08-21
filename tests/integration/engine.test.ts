import { eq, inArray, like } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { bankAccount, COMPANY_ID, companyIdentity, vatRate } from "@/db/schema/company";
import { auditEntry } from "@/db/schema/control";
import { document, documentLine, numberingSeries } from "@/db/schema/document";
import { blockingRule } from "@/db/schema/interface";
import { party } from "@/db/schema/party";
import { checklist, summarise } from "@/documents/checklist";
import { Blocked, confirmRule, ensureRulesExist } from "@/documents/compliance";
import { NotRenderable, render } from "@/documents/engine";
import { peekNumber } from "@/documents/numbering";
import { toPdf } from "@/documents/pdf";
import { saveIdentity, setLogo } from "@/domain/company";
import { computeTotals, lineTotalExcl } from "@/domain/money";

/** Intl uses a narrow no-break space in French, which is correct typography. */
const spaces = (s: string | undefined) => (s ?? "").replace(/[  ]/g, " ");

/**
 * Screen 70 — one engine, five callers.
 *
 * docs/PLAN.md's phase-3 test is "the same offer renders in French for a client
 * and English for a supplier, from one template family". That is the sixth test
 * below. The rest are the promises the middle column of screen 70 makes, in the
 * order it makes them — and the one that matters most is that a document which
 * fails a confirmed rule never consumes a number.
 */
const ACTOR = "test-engine-actor";

/** Read the finished PDF back the way screen 39 reads a supplier's. */
async function pdfText(bytes: Buffer): Promise<string> {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), {
    mergePages: true,
  });
  return text;
}

/**
 * The REAL kind, not `test_invoice`.
 *
 * The first version of this file invented a kind so it could delete the series
 * afterwards — and the compliance rules, which are keyed on `invoice.*`, then
 * matched nothing and the test passed while proving nothing. So it uses the
 * real kind and puts back exactly what it found instead.
 */
const KIND = "invoice";

let hadIdentity = false;
let existingSeries: typeof numberingSeries.$inferSelect | undefined;
let clientId: string;
let supplierId: string;
const docIds: string[] = [];

const IDENTITY = {
  legalName: "SARL SUPSERV (TEST ENGINE)",
  tradeName: "",
  legalForm: "SARL",
  capital: "",
  rc: "01/00-1234567 B 15",
  nif: "000116001234567",
  nis: "000116001234567001",
  ai: "16050123456",
  address: "Zone industrielle, Adrar",
  wilaya: "Adrar",
  phone: "",
  email: "",
  website: "",
};

async function makeDocument(partyId: string, locale: string, total = "84200.00") {
  const [row] = await db
    .insert(document)
    .values({
      kind: KIND,
      partyId,
      locale,
      status: "draft",
      currency: "DZD",
      totals: { totalExcl: "70756.30", totalIncl: total },
    })
    .returning({ id: document.id });

  const id = row?.id as string;
  docIds.push(id);

  await db.insert(documentLine).values({
    documentId: id,
    position: 1,
    lineKind: "item",
    designation: "Mégaphone portatif 25W",
    unit: "U",
    qty: "12.0000",
    unitPrice: "5896.3600",
    vatRate: "19.00",
    totalExcl: "70756.30",
  });

  return id;
}

beforeAll(async () => {
  const [existing] = await db
    .select()
    .from(companyIdentity)
    .where(eq(companyIdentity.id, COMPANY_ID));
  hadIdentity = Boolean(existing);

  await saveIdentity(IDENTITY, ACTOR);
  // The logo is one of the four blocking steps on screen 85, and leaving it out
  // is how the first run of this test discovered the gate actually works.
  await setLogo("company/logo-test.png", ACTOR);
  await ensureRulesExist();

  // Whatever is configured is put back in afterAll, byte for byte. A test that
  // silently resets a numbering series is a test that loses somebody's numbers.
  [existingSeries] = await db.select().from(numberingSeries).where(eq(numberingSeries.kind, KIND));

  await db.delete(numberingSeries).where(eq(numberingSeries.kind, KIND));
  await db
    .insert(numberingSeries)
    .values({ kind: KIND, pattern: "SUP/{YYYY}/{####}", reset: "yearly", nextValue: 42 });

  await db.delete(vatRate).where(like(vatRate.authority, "TESTENG %"));
  await db.insert(vatRate).values({
    rate: "19.000",
    kind: "normal",
    startsOn: "2017-01-01",
    authority: "TESTENG lf2017",
  });

  await db.delete(bankAccount).where(like(bankAccount.bankName, "TESTENG %"));
  await db
    .insert(bankAccount)
    .values({ bankName: "TESTENG BEA", rib: "00300123456789012345", isDefault: true });

  await db.delete(party).where(inArray(party.code, ["TEST-EN-CLIENT", "TEST-EN-SUPPLIER"]));
  const [c] = await db
    .insert(party)
    .values({
      code: "TEST-EN-CLIENT",
      legalName: "SADEG TEST",
      nif: "000116007654321",
      address: "Alger",
      docLocale: "fr",
    })
    .returning({ id: party.id });
  const [s] = await db
    .insert(party)
    .values({
      code: "TEST-EN-SUPPLIER",
      legalName: "DORMAKABA TEST",
      nif: "000116001111111",
      address: "Frankfurt",
      docLocale: "en",
    })
    .returning({ id: party.id });
  clientId = c?.id as string;
  supplierId = s?.id as string;
});

afterAll(async () => {
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  if (docIds.length) {
    await db.delete(documentLine).where(inArray(documentLine.documentId, docIds));
    await db.delete(document).where(inArray(document.id, docIds));
  }
  await db.delete(numberingSeries).where(eq(numberingSeries.kind, KIND));
  if (existingSeries) {
    await db.insert(numberingSeries).values(existingSeries);
  }
  await db.delete(vatRate).where(like(vatRate.authority, "TESTENG %"));
  await db.delete(bankAccount).where(like(bankAccount.bankName, "TESTENG %"));
  await db.delete(party).where(inArray(party.code, ["TEST-EN-CLIENT", "TEST-EN-SUPPLIER"]));
  await db
    .update(blockingRule)
    .set({ confirmedBy: null, confirmedOn: null })
    .where(eq(blockingRule.code, "invoice.stampDutyThreshold"));
  if (!hadIdentity) await db.delete(companyIdentity).where(eq(companyIdentity.id, COMPANY_ID));
});

describe("screen 70 — one engine", () => {
  it("reserves no number on a preview", async () => {
    const before = await peekNumber(KIND);
    const id = await makeDocument(clientId, "fr");

    const preview = await render({ documentId: id, purpose: "preview", actorId: ACTOR });
    expect(preview.number, "screen 70: never on a preview").toBeNull();

    // And the series did not move.
    expect(await peekNumber(KIND)).toBe(before);
  });

  it("pulls the company identity from master data, never from a template", async () => {
    const id = await makeDocument(clientId, "fr");
    const out = await render({ documentId: id, purpose: "preview", actorId: ACTOR });

    expect(out.company.rc).toBe(IDENTITY.rc);
    expect(out.company.nif).toBe(IDENTITY.nif);
    expect(out.company.address).toBe(IDENTITY.address);
    expect(out.bank?.rib).toBe("00300123456789012345");
  });

  it("takes the language from the counterparty, not from anybody signed in", async () => {
    const forClient = await render({
      documentId: await makeDocument(clientId, "fr"),
      purpose: "preview",
      actorId: ACTOR,
    });
    const forSupplier = await render({
      documentId: await makeDocument(supplierId, "en"),
      purpose: "preview",
      actorId: ACTOR,
    });

    // LAW 4, and phase 3's acceptance test: one template family, two languages.
    expect(forClient.locale).toBe("fr");
    expect(forSupplier.locale).toBe("en");
    expect(forClient.template).toContain("FR");
    expect(forSupplier.template).toContain("EN");

    expect(forClient.amountInWords).toContain("dinars algériens");
    expect(forSupplier.amountInWords).toContain("Algerian dinars");

    // 84 200,00 in French, 84,200.00 in English — same number, same engine.
    // French separates thousands with a narrow no-break space, not a plain one.
    expect(spaces(forClient.totals.find((t) => t.label === "totalIncl")?.value)).toBe("84 200,00");
    expect(forSupplier.totals.find((t) => t.label === "totalIncl")?.value).toBe("84,200.00");
  });

  it("warns on an unconfirmed rule and lets you proceed", async () => {
    const id = await makeDocument(clientId, "fr");
    const out = await render({
      documentId: id,
      purpose: "issue",
      actorId: ACTOR,
      settlementInCash: true,
    });

    const stamp = out.findings.find((f) => f.code === "invoice.stampDutyThreshold");
    expect(stamp?.severity, "screen 85: it warns until somebody confirms it").toBe("warn");
    expect(out.number, "and the document still issued").toMatch(/^SUP\/\d{4}\/\d{4}$/);
  });

  it("refuses on the same rule once a person has confirmed it", async () => {
    await confirmRule("invoice.stampDutyThreshold", "Le comptable");
    const id = await makeDocument(clientId, "fr");

    await expect(
      render({ documentId: id, purpose: "issue", actorId: ACTOR, settlementInCash: true }),
    ).rejects.toBeInstanceOf(Blocked);
  });

  it("consumes no number when a confirmed rule refuses", async () => {
    const before = await peekNumber(KIND);
    const id = await makeDocument(clientId, "fr");

    await render({
      documentId: id,
      purpose: "issue",
      actorId: ACTOR,
      settlementInCash: true,
    }).catch(() => null);

    // The compliance profile runs BEFORE the number is reserved, so a refusal
    // leaves no gap in the series. A gap in an invoice series is a question
    // from the tax office.
    expect(await peekNumber(KIND)).toBe(before);
  });

  it("allocates the number and freezes the document", async () => {
    await confirmRule("invoice.stampDutyThreshold", "").catch(() => null);
    await db
      .update(blockingRule)
      .set({ confirmedBy: null, confirmedOn: null })
      .where(eq(blockingRule.code, "invoice.stampDutyThreshold"));

    const id = await makeDocument(clientId, "fr");
    const out = await render({ documentId: id, purpose: "issue", actorId: ACTOR });

    expect(out.number).toMatch(/^SUP\/\d{4}\/\d{4}$/);

    const [row] = await db.select().from(document).where(eq(document.id, id));
    expect(row?.status).toBe("issued");
    expect(row?.lockedAt, "LAW 5 — frozen at issue").not.toBeNull();
    expect(row?.number).toBe(out.number);
  });

  it("refuses to issue the same document twice", async () => {
    const id = await makeDocument(clientId, "fr");
    await render({ documentId: id, purpose: "issue", actorId: ACTOR });

    // LAW 5 — an issued document is immutable, and that includes re-issuing it.
    await expect(
      render({ documentId: id, purpose: "issue", actorId: ACTOR }),
    ).rejects.toBeInstanceOf(NotRenderable);
  });

  it("never allocates the same number twice, even under a race", async () => {
    const ids = await Promise.all([
      makeDocument(clientId, "fr"),
      makeDocument(clientId, "fr"),
      makeDocument(clientId, "fr"),
    ]);

    const numbers = await Promise.all(
      ids.map((id) => render({ documentId: id, purpose: "issue", actorId: ACTOR })),
    );

    const seen = numbers.map((n) => n.number);
    expect(new Set(seen).size, "three issues, three numbers").toBe(3);
  });

  it("writes who issued it and from which template", async () => {
    const entries = await db.select().from(auditEntry).where(eq(auditEntry.actorId, ACTOR));
    const issued = entries.filter((e) => e.action === "issue");
    expect(issued.length).toBeGreaterThan(0);

    const after = issued[0]?.after as { template?: string; number?: string };
    expect(after?.template).toContain("SUPSERV");
    expect(after?.number).toMatch(/^SUP\//);
    expect(issued[0]?.sourceScreen).toBe("70");
  });

  it("refuses a document whose counterparty has vanished", async () => {
    await expect(
      render({
        documentId: "00000000-0000-0000-0000-000000000000",
        purpose: "preview",
        actorId: ACTOR,
      }),
    ).rejects.toBeInstanceOf(NotRenderable);
  });

  /**
   * Screen 72 → screen 18. A draft typed by hand, stored exactly the way the
   * New invoice action stores it — totals from `computeTotals`, no number — and
   * then carried all the way to bytes. This is the join between the two screens
   * and it is the join that was never exercised before.
   */
  it("carries a hand-typed draft through to a PDF a client could read", async () => {
    const lines = [
      { qty: "3", unitPrice: "12000", vatRate: "19" },
      { qty: "2", unitPrice: "5000", vatRate: "9" },
    ];
    const totals = computeTotals(lines);

    const [row] = await db
      .insert(document)
      .values({
        kind: KIND,
        partyId: clientId,
        locale: "fr",
        currency: "DZD",
        status: "draft",
        issuedOn: "2026-08-19",
        totals,
      })
      .returning({ id: document.id });
    const id = row?.id as string;
    docIds.push(id);

    await db.insert(documentLine).values(
      lines.map((line, index) => ({
        documentId: id,
        position: index + 1,
        lineKind: "item",
        designation: index === 0 ? "Galets de convoyeur" : "Transport",
        unit: "U",
        qty: line.qty,
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        totalExcl: lineTotalExcl(line).toFixed(2),
      })),
    );

    const preview = await render({ documentId: id, purpose: "preview", actorId: ACTOR });

    // LAW 5, on the screen and in the bytes: a draft carries no number.
    expect(preview.number).toBeNull();
    expect(preview.totals.map((t) => t.label)).toEqual([
      "totalExcl",
      "vat:19.00",
      "vat:9.00",
      "totalIncl",
    ]);

    const text = await pdfText(await toPdf(preview));
    expect(text).toContain("BROUILLON");
    expect(spaces(text)).toContain("TVA 19");
    expect(spaces(text)).toContain("TVA 9");
    expect(text, "the VAT object must never reach the page as NaN").not.toContain("NaN");

    // 46 000 HT + 6 840 (19% of 36 000) + 900 (9% of 10 000) = 53 740, and the
    // sentence underneath has to agree with the figure above it.
    expect(spaces(text)).toContain("53 740,00");
    expect(text).toContain("cinquante-trois mille sept cent quarante dinars algériens");

    // The checklist the screen draws over the same render.
    const rows = checklist(preview);
    expect(summarise(rows).blockers, "this client has a NIF").toBe(0);
    expect(rows.find((r) => r.key === "documentNumber")?.noteKey).toBe("numberOnIssue");
    expect(rows.find((r) => r.key === "clientNif")?.state).toBe("pass");
  });
});
