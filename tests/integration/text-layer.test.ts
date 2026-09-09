import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { extractText, NeedsOcr } from "@/capture/ocr/provider";
import {
  isFullyDigital,
  readTextLayer,
  stripUnstorable,
  toOcrResult,
} from "@/capture/ocr/text-layer";
import { proposeFields } from "@/domain/intake/extract";

/**
 * docs/OCR.md, step 1: the PDF's own text layer, measured at 0.055s and perfect
 * on a digital bordereau.
 *
 * These tests build a real PDF and read it back through the real reader, rather
 * than handing the parser a string. The bugs in this layer are all in the gap
 * between the two: fragments split mid-word, hyphens at line ends, a page whose
 * only "text" is a scanner's page number.
 */
async function pdfWith(pages: string[][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const lines of pages) {
    const page = doc.addPage([595, 842]); // A4
    let y = 780;
    for (const line of lines) {
      page.drawText(line, { x: 50, y, size: 11, font });
      y -= 18;
    }
  }
  return Buffer.from(await doc.save());
}

describe("reading a digital PDF without OCR", () => {
  it("reads every page, in order", async () => {
    const file = await pdfWith([
      [
        "ARTICLE 7 - PRESENTATION DES OFFRES",
        "Les offres doivent etre deposees au bureau des marches.",
      ],
      ["ARTICLE 8 - CAUTION DE SOUMISSION", "Le soumissionnaire doit joindre une caution."],
    ]);

    const layer = await readTextLayer(file);
    expect(layer.totalPages).toBe(2);
    expect(layer.pages[0]?.text).toContain("ARTICLE 7");
    expect(layer.pages[1]?.text).toContain("ARTICLE 8");
    expect(isFullyDigital(layer)).toBe(false); // these two pages are short
  });

  it("keeps lines separate, so a citation can point at one", async () => {
    const file = await pdfWith([["Premiere ligne.", "Deuxieme ligne.", "Troisieme ligne."]]);
    const layer = await readTextLayer(file);
    expect(layer.pages[0]?.lines).toEqual([
      "Premiere ligne.",
      "Deuxieme ligne.",
      "Troisieme ligne.",
    ]);
  });

  it("calls a page with almost no text what it is", async () => {
    // A scanned page: the image carries the words, and the only real text is
    // the page number a scanner stamped on it.
    const file = await pdfWith([
      ["4"],
      Array.from({ length: 14 }, () => "Une ligne de texte reelle et complete sur cette page."),
    ]);
    const layer = await readTextLayer(file);

    expect(layer.thinPages, "page 1 is a scan, page 2 is not").toEqual([1]);
    expect(isFullyDigital(layer)).toBe(false);
  });

  it("reports confidence 1, because this is not a reading — it is the file", async () => {
    const file = await pdfWith([
      Array.from(
        { length: 14 },
        () => "Texte reel et suffisamment long pour compter comme une page.",
      ),
    ]);
    const result = toOcrResult(await readTextLayer(file));

    expect(result.provider).toBe("text-layer");
    expect(result.confidence).toBe(1);
    expect(result.blocks.every((b) => b.confidence === 1)).toBe(true);
  });

  it("knows the document is French", async () => {
    const file = await pdfWith([
      [
        "Conformement a l'article 12 du reglement de la consultation, les offres",
        "des soumissionnaires seront deposees au bureau des marches de la",
        "direction, selon les modalites prevues aux articles suivants du present",
        "cahier des charges applicable au marche.",
      ],
    ]);
    const result = toOcrResult(await readTextLayer(file));
    expect(result.detectedLocale).toBe("fr");
  });

  it("refuses to pretend a scan was read", async () => {
    const file = await pdfWith([["4"]]);
    // A half-read dossier that reports success is how a missing document loses
    // a bid. The pages that could not be read are named.
    await expect(extractText(file, "application/pdf")).rejects.toBeInstanceOf(NeedsOcr);
  });

  it("goes from a PDF to proposed fields with citations, end to end", async () => {
    const file = await pdfWith([
      ["AVIS D'APPEL D'OFFRES NATIONAL N 12/2026"],
      [
        "ARTICLE 7 - PRESENTATION DES OFFRES",
        "Les offres doivent etre deposees au bureau des marches de la Direction",
        "au plus tard le 02 septembre 2026 a 10 heures 00.",
      ],
      [
        "ARTICLE 11 - DELAI DE VALIDITE",
        "Le delai de validite des offres est fixe a 90 jours a compter du depot.",
      ],
    ]);

    const layer = await readTextLayer(file);
    const fields = proposeFields(layer.pages);

    const validity = fields.find((f) => f.key === "offerValidity");
    expect(validity?.value).toBe("90 jours");
    expect(validity?.citation.page, "page 3 of the file").toBe(3);
    expect(validity?.citation.article).toBe("article 11");
  });
});

describe("the one character Postgres will not hold", () => {
  /**
   * Found by 1.11's catch-up on the real mailbox: a CV whose font mapping had
   * no glyph for one character, so pdf.js returned U+0000. `text` in Postgres
   * has no representation for a NUL, so the page insert was refused (22P05)
   * and the whole document was lost over a character nobody typed.
   */
  it("takes a NUL out of the text rather than losing the document to it", () => {
    const read = "BOUDEBA MOHAMED / AIDE-SOIGNANT\u0000\nAide-soignant motive";

    expect(read).toContain("\u0000");
    expect(stripUnstorable(read)).toBe("BOUDEBA MOHAMED / AIDE-SOIGNANT\nAide-soignant motive");
  });

  it("removes it rather than replacing it, because nothing was there to read", () => {
    // A replacement mark would tell a person the document said something it
    // did not. The absence of a character is not an unreadable character.
    expect(stripUnstorable("a\u0000b")).toBe("ab");
    expect(stripUnstorable("a\u0000b")).not.toContain("\ufffd");
  });

  it("leaves every other character alone", () => {
    const text = "Article 7 — dépôt des offres · 10 heures 00\nالمادة 7";
    expect(stripUnstorable(text)).toBe(text);
  });
});
