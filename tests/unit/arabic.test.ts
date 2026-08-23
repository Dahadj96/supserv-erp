import { describe, expect, it } from "vitest";
import { hasArabic, isPresentationForm, repairArabic } from "@/capture/ocr/arabic";

/**
 * docs/OCR.md §4 — the finding that would otherwise have cost days.
 *
 * The measurement in that document is the assertion below: the header of an
 * Algerian tender notice comes out of a PDF text layer as reversed presentation
 * glyphs, and after the repair a person typing الجزائرية finds it.
 */
const AS_STORED = "ﺔﻴﺒﻌﺸﻟا ﺔﻴﻃاﺮﻘﻤﻳﺪﻟا ﺔﻳﺮﺋاﺰﺠﻟا ﺔﻳرﻮﻬﻤﺠﻟا";
const AS_TYPED = "الجمهورية الجزائرية الديمقراطية الشعبية";

describe("Arabic out of a PDF text layer", () => {
  it("recognises presentation forms for what they are", () => {
    expect(isPresentationForm(AS_STORED)).toBe(true);
    expect(isPresentationForm(AS_TYPED), "already base letters").toBe(false);
    expect(isPresentationForm("Bordereau des prix unitaires")).toBe(false);
  });

  it("repairs the header of a tender notice into something a person can read", () => {
    const { text, repaired, stillBroken } = repairArabic(AS_STORED);

    expect(repaired).toBe(true);
    expect(stillBroken).toBe(false);
    expect(text).toBe(AS_TYPED);
  });

  it("makes it findable, which is the point", () => {
    // Before: a user searching for the country's name gets nothing.
    expect(AS_STORED.includes("الجزائرية")).toBe(false);
    expect(repairArabic(AS_STORED).text.includes("الجزائرية")).toBe(true);
  });

  it("leaves a French page completely alone", () => {
    const french = "Bordereau des prix unitaires\n2×1,5 mm²   U   1 250,00 DA";
    const { text, repaired } = repairArabic(french);

    expect(repaired, "nothing to repair means nothing is touched").toBe(false);
    expect(text).toBe(french);
  });

  it("does not reverse a reference or a date caught inside an Arabic line", () => {
    // This is the line docs/OCR.md records Tesseract failing on: Arabic mixed
    // with a Latin reference. Reversed naively it becomes 6202/AD/52.
    const stored = `${"ﺔﻴﺒﻌﺸﻟا"} 25/DA/2026`;
    const { text } = repairArabic(stored);

    expect(text).toContain("25/DA/2026");
    expect(text).not.toContain("6202/AD/52");
    expect(text).toContain("الشعبية");
  });

  it("keeps a decimal quantity intact", () => {
    const stored = `${"ﺔﻳرﻮﻬﻤﺠﻟا"} 1,5 mm`;
    expect(repairArabic(stored).text).toContain("1,5 mm");
  });

  it("repairs each line on its own, so a mixed page survives", () => {
    const page = `Bordereau des prix\n${AS_STORED}\nTotal HT 1 250,00`;
    const { text } = repairArabic(page);
    const lines = text.split("\n");

    expect(lines[0]).toBe("Bordereau des prix");
    expect(lines[1]).toBe(AS_TYPED);
    expect(lines[2]).toBe("Total HT 1 250,00");
  });

  it("knows Arabic when it sees it, in either shape", () => {
    expect(hasArabic(AS_STORED)).toBe(true);
    expect(hasArabic(AS_TYPED)).toBe(true);
    expect(hasArabic("Facture proforma")).toBe(false);
  });
});
