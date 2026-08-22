import { eq, inArray, like } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { bankAccount, COMPANY_ID, companyIdentity, vatRate } from "@/db/schema/company";
import { document, documentLine, numberingSeries } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import { ensureRulesExist } from "@/documents/compliance";
import { render } from "@/documents/engine";
import { toPdf } from "@/documents/pdf";
import { ensureTemplatesExist } from "@/documents/templates";
import { saveIdentity, setLogo } from "@/domain/company";

/**
 * Screen 71 — "Reprinting an invoice from 2026 in 2029 must produce the 2026
 * document, not the current layout."
 *
 * This is the test that makes the snapshot worth having. A company moves
 * premises, renews its RC, changes bank. Every one of those is printed on
 * invoices already sent to clients and already filed with an accountant, and
 * not one of them may change retroactively — LAW 5 is about the whole document,
 * not only its total.
 */
const ACTOR = "test-reprint-actor";
const KIND = "invoice";
const CODE = "TEST-REPRINT-CLIENT";

const OLD = {
  legalName: "SARL SUPSERV (TEST REPRINT)",
  tradeName: "",
  legalForm: "SARL",
  capital: "",
  rc: "01/00-1111111 B 09",
  nif: "000116001111111",
  nis: "000116001111111001",
  ai: "16050111111",
  address: "Ancienne adresse, Adrar",
  wilaya: "Adrar",
  phone: "",
  email: "",
  website: "",
};

const NEW = {
  ...OLD,
  rc: "01/00-2222222 B 09",
  address: "Nouvelle adresse, Zone industrielle, Adrar",
};

let hadIdentity: typeof companyIdentity.$inferSelect | undefined;
let existingSeries: typeof numberingSeries.$inferSelect | undefined;
let clientId: string;
const docIds: string[] = [];

async function pdfText(bytes: Buffer): Promise<string> {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), {
    mergePages: true,
  });
  return text;
}

beforeAll(async () => {
  [hadIdentity] = await db.select().from(companyIdentity).where(eq(companyIdentity.id, COMPANY_ID));

  await saveIdentity(OLD, ACTOR);
  await setLogo("company/logo-test.png", ACTOR);
  await ensureRulesExist();
  await ensureTemplatesExist();

  [existingSeries] = await db.select().from(numberingSeries).where(eq(numberingSeries.kind, KIND));
  await db.delete(numberingSeries).where(eq(numberingSeries.kind, KIND));
  await db
    .insert(numberingSeries)
    .values({ kind: KIND, pattern: "RPT/{YYYY}/{####}", reset: "yearly", nextValue: 1 });

  // Day one's third blocking step. Leaving it out is how the first run of this
  // test discovered the gate was doing its job.
  await db.delete(vatRate).where(like(vatRate.authority, "TESTRPT %"));
  await db.insert(vatRate).values({
    rate: "19.000",
    kind: "normal",
    startsOn: "2017-01-01",
    authority: "TESTRPT lf2017",
  });

  await db.delete(bankAccount).where(like(bankAccount.bankName, "TESTRPT %"));
  await db
    .insert(bankAccount)
    .values({ bankName: "TESTRPT BADR", rib: "00300111111111111111", isDefault: true });

  await db.delete(party).where(eq(party.code, CODE));
  const [client] = await db
    .insert(party)
    .values({
      code: CODE,
      legalName: "CLIENT REPRINT",
      nif: "000116009999999",
      address: "Alger",
      docLocale: "fr",
    })
    .returning({ id: party.id });
  clientId = client?.id as string;
});

afterAll(async () => {
  if (docIds.length > 0) {
    await db.delete(documentLine).where(inArray(documentLine.documentId, docIds));
    await db.delete(document).where(inArray(document.id, docIds));
  }
  await db.delete(party).where(eq(party.code, CODE));
  await db.delete(bankAccount).where(like(bankAccount.bankName, "TESTRPT %"));
  await db.delete(vatRate).where(like(vatRate.authority, "TESTRPT %"));

  await db.delete(numberingSeries).where(eq(numberingSeries.kind, KIND));
  if (existingSeries) await db.insert(numberingSeries).values(existingSeries);

  if (hadIdentity) {
    await db.update(companyIdentity).set(hadIdentity).where(eq(companyIdentity.id, COMPANY_ID));
  } else {
    await db.delete(companyIdentity).where(eq(companyIdentity.id, COMPANY_ID));
  }
});

async function makeDraft() {
  const [row] = await db
    .insert(document)
    .values({
      kind: KIND,
      partyId: clientId,
      locale: "fr",
      currency: "DZD",
      status: "draft",
      totals: { totalExcl: "1000.00", totalIncl: "1190.00" },
    })
    .returning({ id: document.id });

  const id = row?.id as string;
  docIds.push(id);

  await db.insert(documentLine).values({
    documentId: id,
    position: 1,
    lineKind: "item",
    designation: "Prestation",
    unit: "U",
    qty: "1.0000",
    unitPrice: "1000.0000",
    vatRate: "19.00",
    totalExcl: "1000.00",
  });

  return id;
}

describe("reprinting an issued document", () => {
  let id: string;

  it("issues under the address and RC of the day", async () => {
    id = await makeDraft();
    const issued = await render({ documentId: id, purpose: "issue", actorId: ACTOR });

    expect(issued.company.rc).toBe(OLD.rc);
    expect(issued.company.address).toBe(OLD.address);
    expect(issued.number).toMatch(/^RPT\//);
  });

  it("freezes what it printed onto the record", async () => {
    const [row] = await db.select().from(document).where(eq(document.id, id));
    const snapshot = row?.renderSnapshot as { company: { rc: string }; templateVersion: number };

    expect(snapshot?.company?.rc).toBe(OLD.rc);
    expect(row?.templateVersion).toBe(1);
    expect(row?.lockedAt).toBeInstanceOf(Date);
  });

  it("gives back the ORIGINAL document after the company moves and renews its RC", async () => {
    await saveIdentity(NEW, ACTOR);

    // Sanity: master data really did change.
    const [master] = await db
      .select()
      .from(companyIdentity)
      .where(eq(companyIdentity.id, COMPANY_ID));
    expect(master?.rc).toBe(NEW.rc);

    const reprint = await render({ documentId: id, purpose: "preview", actorId: ACTOR });

    expect(reprint.company.rc, "an issued document does not learn the new RC").toBe(OLD.rc);
    expect(reprint.company.address).toBe(OLD.address);

    const text = await pdfText(await toPdf(reprint));
    expect(text).toContain(OLD.rc);
    expect(text).toContain("Ancienne adresse");
    expect(text, "the new address must not appear on a document already sent").not.toContain(
      "Nouvelle adresse",
    );
  });

  it("still prints the bank account the client was told to pay into", async () => {
    await db
      .update(bankAccount)
      .set({ isDefault: false })
      .where(like(bankAccount.bankName, "TESTRPT %"));
    await db
      .insert(bankAccount)
      .values({ bankName: "TESTRPT BEA", rib: "00200222222222222222", isDefault: true });

    const reprint = await render({ documentId: id, purpose: "preview", actorId: ACTOR });
    expect(reprint.bank?.rib).toBe("00300111111111111111");

    await db.delete(bankAccount).where(eq(bankAccount.bankName, "TESTRPT BEA"));
  });

  it("gives a NEW document the new address, because it has promised nobody anything", async () => {
    const fresh = await makeDraft();
    const preview = await render({ documentId: fresh, purpose: "preview", actorId: ACTOR });

    expect(preview.company.rc).toBe(NEW.rc);
    expect(preview.company.address).toBe(NEW.address);
    expect(preview.number, "and still no number until somebody issues it").toBeNull();
  });
});
