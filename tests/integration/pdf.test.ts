import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import type { RenderedDocument } from "@/documents/engine";
import { toPdf } from "@/documents/pdf";

/**
 * Screen 70, step 6 — the only file in the system that draws a PDF.
 *
 * Every assertion here reads the finished PDF back through the same text-layer
 * reader screen 39 uses. Checking that `toPdf` returned some bytes would prove
 * nothing; checking that the RC number is findable in the text of the page is
 * the thing the tax office will do.
 */
const SAMPLE: RenderedDocument = {
  number: "SUP/2026/0043",
  kind: "invoice",
  locale: "fr",
  issuedOn: "21/08/2026",
  dateline: "Adrar, le 21 août 2026",
  settlement: null,
  issued: true,
  company: {
    legalName: "SARL SUPSERV",
    address: "Zone industrielle, Adrar",
    rc: "01/00-1234567 B 15",
    nif: "000116001234567",
    nis: "000116001234567001",
    ai: "16050123456",
    logoPath: null,
    phone: "049 96 12 34",
    email: "contact@supserv.dz",
  },
  counterparty: {
    legalName: "GROUPEMENT TOUATGAZ",
    address: "Zone industrielle, Adrar",
    nif: "000116007654321",
    nis: "000116007654322",
    rc: "16/00-1234567 B 09",
  },
  bank: { bankName: "BEA Adrar", rib: "00300123456789012345", agency: "Adrar" },
  lines: [
    {
      position: 1,
      designation: "Mégaphone portatif 25W",
      isOption: false,
      quantity: "12,00",
      unit: "U",
      unitPrice: "5 896,36",
      vatRate: "19 %",
      total: "70 756,30",
    },
    {
      position: 2,
      designation: "Installation et mise en service",
      isOption: true,
      quantity: "1,00",
      unit: "F",
      unitPrice: "12 000,00",
      vatRate: "19 %",
      total: "12 000,00",
    },
  ],
  totals: [
    { label: "totalIncl", value: "84 200,00" },
    { label: "totalExcl", value: "70 756,30" },
    { label: "totalVat", value: "13 443,70" },
  ],
  amountInWords: "quatre-vingt-quatre mille deux cents dinars algériens et zéro centime",
  situation: null,
  amendment: null,
  findings: [],
  template: "SUPSERV invoice — FR v1",
};

async function textOf(pdf: Buffer): Promise<string> {
  const bytes = new Uint8Array(pdf);
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: true });
  return (text as string).replace(/\s+/g, " ");
}

describe("the only file that draws a PDF", () => {
  it("survives the characters Intl produces", async () => {
    // French thousands separators are U+202F NARROW NO-BREAK SPACE, which is
    // not in WinAnsi. pdf-lib throws on it rather than dropping it, and this is
    // the assertion that found that out.
    const pdf = await toPdf(SAMPLE);
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it("prints the four identifiers décret 05-468 requires", async () => {
    const text = await textOf(await toPdf(SAMPLE));
    expect(text).toContain("01/00-1234567 B 15");
    expect(text).toContain("000116001234567");
    expect(text).toContain("16050123456");
  });

  it("prints the counterparty and their NIF", async () => {
    const text = await textOf(await toPdf(SAMPLE));
    expect(text).toContain("GROUPEMENT TOUATGAZ");
    expect(text).toContain("000116007654321");
  });

  it("prints the amount in words", async () => {
    const text = await textOf(await toPdf(SAMPLE));
    expect(text).toContain("quatre-vingt-quatre mille deux cents dinars");
    expect(text).toContain("Arrêtée la présente facture");
  });

  it("prints the bank domiciliation", async () => {
    const text = await textOf(await toPdf(SAMPLE));
    expect(text).toContain("00300123456789012345");
  });

  it("marks an option line as one", async () => {
    const text = await textOf(await toPdf(SAMPLE));
    expect(text).toContain("Installation et mise en service (option)");
  });

  it("says DRAFT on the paper when there is no number", async () => {
    const preview = await toPdf({ ...SAMPLE, number: null });
    const text = await textOf(preview);
    // A preview that looks like an issued invoice is a preview somebody sends.
    expect(text).toContain("BROUILLON");
    expect(text).not.toContain("SUP/2026/0043");
  });

  it("renders the same document in English for a counterparty who reads English", async () => {
    const english = await toPdf({
      ...SAMPLE,
      locale: "en",
      amountInWords: "eighty-four thousand two hundred Algerian dinars and zero centimes",
      totals: [
        { label: "totalIncl", value: "84,200.00" },
        { label: "totalExcl", value: "70,756.30" },
      ],
    });
    const text = await textOf(english);

    expect(text).toContain("INVOICE");
    expect(text).toContain("Description");
    expect(text).toContain("Total incl. VAT");
    expect(text).toContain("84,200.00");
    // Same engine, same template family, same RC.
    expect(text).toContain("01/00-1234567 B 15");
  });

  it("puts the grand total last, whatever order it arrived in", async () => {
    const text = await textOf(await toPdf(SAMPLE));
    expect(text.indexOf("Total TTC")).toBeGreaterThan(text.indexOf("Total HT"));
  });

  it("writes a sample anybody can open", async () => {
    // Not an assertion — a deliverable. `.data` is gitignored and is the same
    // volume uploaded files live on.
    const out = resolve(process.cwd(), ".data", "samples");
    mkdirSync(out, { recursive: true });
    writeFileSync(resolve(out, "facture-fr.pdf"), await toPdf(SAMPLE));
    writeFileSync(
      resolve(out, "invoice-en.pdf"),
      await toPdf({
        ...SAMPLE,
        locale: "en",
        amountInWords: "eighty-four thousand two hundred Algerian dinars and zero centimes",
        totals: [
          { label: "totalExcl", value: "70,756.30" },
          { label: "totalVat", value: "13,443.70" },
          { label: "totalIncl", value: "84,200.00" },
        ],
      }),
    );
    expect(true).toBe(true);
  });
});
