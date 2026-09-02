import { eq, inArray, like } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { COMPANY_ID, companyIdentity, vatRate } from "@/db/schema/company";
import { auditEntry } from "@/db/schema/control";
import { document, documentLine, numberingSeries } from "@/db/schema/document";
import { blockingRule } from "@/db/schema/interface";
import { party } from "@/db/schema/party";
import { Blocked, confirmRule, ensureRulesExist } from "@/documents/compliance";
import { type DraftPatch, saveDraft } from "@/documents/draft";
import { render } from "@/documents/engine";
import { toPdf } from "@/documents/pdf";
import { saveIdentity, setLogo } from "@/domain/company";
import { STAMP_DUTY_RULE } from "@/domain/money/instruments";

/** Intl uses a narrow no-break space in French, which is correct typography. */
const spaces = (s: string | undefined) => (s ?? "").replace(/[  ]/g, " ");

async function pdfText(bytes: Buffer): Promise<string> {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), {
    mergePages: true,
  });
  return text;
}

/**
 * Décret 05-468 asks every facture to say how it is settled, and the Code du
 * timbre (art. 100, as LF 2025 art. 47 rewrote it) puts a droit de timbre on
 * the ones settled in cash. This file walks the path a person actually takes:
 * screen 47 (the builder) → screen 70 (issue) → the PDF the client reads —
 * once with the rule still waiting on the accountant, once after it is
 * confirmed on screen 69.
 */
const ACTOR = "test-stamp-duty-actor";
const KIND = "invoice";

let previousIdentity: typeof companyIdentity.$inferSelect | undefined;
let existingSeries: typeof numberingSeries.$inferSelect | undefined;
let previousRule: typeof blockingRule.$inferSelect | undefined;
let clientId: string;
const docIds: string[] = [];

const IDENTITY = {
  legalName: "SARL SUPSERV (TEST STAMP)",
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

/** 10 × 5 000 HT at 19 % → 50 000 HT, 9 500 TVA, 59 500 TTC. */
const LINES: DraftPatch["lines"] = [
  {
    lineKind: "item",
    designation: "Galets de convoyeur",
    unit: "U",
    qty: "10",
    unitPrice: "5000",
    vatRate: "19",
  },
];

async function newDraft(): Promise<string> {
  const [row] = await db
    .insert(document)
    .values({
      kind: KIND,
      partyId: clientId,
      locale: "fr",
      status: "draft",
      currency: "DZD",
      issuedOn: "2026-09-01",
      totals: { totalExcl: "0.00", totalIncl: "0.00" },
    })
    .returning({ id: document.id });
  const id = row?.id as string;
  docIds.push(id);
  return id;
}

async function stored(id: string) {
  const [row] = await db.select().from(document).where(eq(document.id, id));
  return row as typeof document.$inferSelect;
}

async function unconfirm() {
  await db
    .update(blockingRule)
    .set({ confirmedBy: null, confirmedOn: null })
    .where(eq(blockingRule.code, STAMP_DUTY_RULE));
}

beforeAll(async () => {
  [previousIdentity] = await db
    .select()
    .from(companyIdentity)
    .where(eq(companyIdentity.id, COMPANY_ID));
  await saveIdentity(IDENTITY, ACTOR);
  await setLogo("company/logo-test.png", ACTOR);
  await ensureRulesExist();

  [existingSeries] = await db.select().from(numberingSeries).where(eq(numberingSeries.kind, KIND));
  [previousRule] = await db
    .select()
    .from(blockingRule)
    .where(eq(blockingRule.code, STAMP_DUTY_RULE));
  await unconfirm();

  await db.delete(numberingSeries).where(eq(numberingSeries.kind, KIND));
  await db
    .insert(numberingSeries)
    .values({ kind: KIND, pattern: "TSD/{YYYY}/{####}", reset: "yearly", nextValue: 1 });

  await db.delete(vatRate).where(like(vatRate.authority, "TESTSD %"));
  await db.insert(vatRate).values({
    rate: "19.000",
    kind: "normal",
    startsOn: "2017-01-01",
    authority: "TESTSD lf2017",
  });

  await db.delete(party).where(eq(party.code, "TEST-SD-CLIENT"));
  const [c] = await db
    .insert(party)
    .values({
      code: "TEST-SD-CLIENT",
      legalName: "SONATRACH TEST",
      nif: "000116007654321",
      address: "Hassi Messaoud",
      docLocale: "fr",
    })
    .returning({ id: party.id });
  clientId = c?.id as string;
});

afterAll(async () => {
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  if (docIds.length) {
    await db.delete(documentLine).where(inArray(documentLine.documentId, docIds));
    await db.delete(document).where(inArray(document.id, docIds));
  }
  await db.delete(numberingSeries).where(eq(numberingSeries.kind, KIND));
  if (existingSeries) await db.insert(numberingSeries).values(existingSeries);
  await db.delete(vatRate).where(like(vatRate.authority, "TESTSD %"));
  await db.delete(party).where(eq(party.code, "TEST-SD-CLIENT"));
  await db
    .update(blockingRule)
    .set({
      confirmedBy: previousRule?.confirmedBy ?? null,
      confirmedOn: previousRule?.confirmedOn ?? null,
    })
    .where(eq(blockingRule.code, STAMP_DUTY_RULE));
  if (previousIdentity) {
    await db
      .update(companyIdentity)
      .set(previousIdentity)
      .where(eq(companyIdentity.id, COMPANY_ID));
  } else {
    await db.delete(companyIdentity).where(eq(companyIdentity.id, COMPANY_ID));
  }
});

describe("mode de règlement and droit de timbre, builder to PDF", () => {
  it("while the rule waits on the accountant: cash carries no duty, and issue warns", async () => {
    const id = await newDraft();
    await saveDraft(id, { settlement: "especes", lines: LINES }, ACTOR);

    const row = await stored(id);
    expect(row.settlement).toBe("especes");
    expect(row.stampDuty).toBe("0.00");
    expect((row.totals as { totalIncl: string }).totalIncl).toBe("59500.00");

    const out = await render({ documentId: id, purpose: "issue", actorId: ACTOR });
    const finding = out.findings.find((f) => f.code === STAMP_DUTY_RULE);
    expect(finding?.severity, "screen 85: a warning, not a wall").toBe("warn");
    expect(out.number).toMatch(/^TSD\/\d{4}\/\d{4}$/);
    expect(out.settlement).toBe("Espèces");
    expect(out.totals.map((t) => t.label)).not.toContain("stampDuty");

    const text = spaces(await pdfText(await toPdf(out)));
    expect(text).toContain("Mode de règlement");
    expect(text).toContain("Espèces");
    expect(text).not.toContain("Droit de timbre");
  });

  it("refuses a settlement it does not know rather than storing a typo", async () => {
    const id = await newDraft();
    await saveDraft(id, { settlement: "bitcoin", lines: LINES }, ACTOR);
    expect((await stored(id)).settlement).toBeNull();
  });

  it("keeps the settlement when a later save does not mention it", async () => {
    const id = await newDraft();
    await saveDraft(id, { settlement: "cheque", lines: LINES }, ACTOR);
    await saveDraft(id, { lines: LINES }, ACTOR);
    expect((await stored(id)).settlement).toBe("cheque");
  });

  it("once confirmed: a cash draft carries the barème and the PDF says so", async () => {
    await confirmRule(STAMP_DUTY_RULE, "Le comptable");
    const id = await newDraft();
    await saveDraft(id, { settlement: "especes", lines: LINES }, ACTOR);

    // 59 500 TTC falls in the ≤ 100 000 bracket: 595 tranches of 100 DA at
    // 1,50 DA each. The duty sits on top of the TTC the client pays.
    const row = await stored(id);
    expect(row.stampDuty).toBe("892.50");
    const totals = row.totals as { stampDuty: string; totalIncl: string };
    expect(totals.stampDuty).toBe("892.50");
    expect(totals.totalIncl).toBe("60392.50");

    const out = await render({ documentId: id, purpose: "issue", actorId: ACTOR });
    expect(out.findings.find((f) => f.code === STAMP_DUTY_RULE)?.severity).toBe("pass");
    expect(out.number).toMatch(/^TSD\/\d{4}\/\d{4}$/);
    expect(spaces(out.totals.find((t) => t.label === "stampDuty")?.value)).toBe("892,50");
    expect(spaces(out.totals.find((t) => t.label === "totalIncl")?.value)).toBe("60 392,50");

    const text = spaces(await pdfText(await toPdf(out)));
    expect(text).toContain("Droit de timbre");
    expect(text).toContain("892,50");
    expect(text).toContain("60 392,50");
    expect(text).toContain("Mode de règlement");
    expect(text).toContain("Espèces");
    // The sentence under the table agrees with the figure above it.
    expect(text).toContain("soixante mille trois cent quatre-vingt-douze dinars algériens");
  });

  it("once confirmed: a bank transfer attracts nothing", async () => {
    const id = await newDraft();
    await saveDraft(id, { settlement: "virement", lines: LINES }, ACTOR);
    const row = await stored(id);
    expect(row.stampDuty).toBe("0.00");
    expect((row.totals as { totalIncl: string }).totalIncl).toBe("59500.00");

    const out = await render({ documentId: id, purpose: "issue", actorId: ACTOR });
    expect(out.findings.find((f) => f.code === STAMP_DUTY_RULE)?.severity).toBe("pass");
    expect(out.settlement).toBe("Virement bancaire");
  });

  it("a cash draft saved before the confirmation is refused until it is saved again", async () => {
    await unconfirm();
    const id = await newDraft();
    await saveDraft(id, { settlement: "especes", lines: LINES }, ACTOR);
    expect((await stored(id)).stampDuty).toBe("0.00");

    // The accountant confirms on screen 69 that afternoon.
    await confirmRule(STAMP_DUTY_RULE, "Le comptable");

    // LAW 2 — the figure on the draft is stale, and a confirmed rule blocks.
    await expect(
      render({ documentId: id, purpose: "issue", actorId: ACTOR }),
    ).rejects.toBeInstanceOf(Blocked);

    // Opening the builder and saving recomputes it; then it issues.
    await saveDraft(id, { lines: LINES }, ACTOR);
    expect((await stored(id)).stampDuty).toBe("892.50");
    const out = await render({ documentId: id, purpose: "issue", actorId: ACTOR });
    expect(out.number).toMatch(/^TSD\//);
  });

  it("an issued document's settlement and duty are frozen with it", async () => {
    const id = await newDraft();
    await saveDraft(id, { settlement: "especes", lines: LINES }, ACTOR);
    await render({ documentId: id, purpose: "issue", actorId: ACTOR });

    await expect(saveDraft(id, { settlement: "virement", lines: LINES }, ACTOR)).rejects.toThrow(
      "alreadyIssued",
    );
    expect((await stored(id)).settlement).toBe("especes");
  });
});
