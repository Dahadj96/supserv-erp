import { describe, expect, it } from "vitest";
import { significantWords } from "@/domain/deal/price-history";
import { chooseCost } from "@/domain/offer/build";

describe("significantWords", () => {
  it("keeps the words that tell two articles apart and drops the glue", () => {
    expect(significantWords("Galet de convoyeur Ø89 × 315 mm")).toEqual([
      "galet",
      "convoyeur",
      "89",
      "315",
    ]);
  });

  it("unaccents and lower-cases, and never repeats a word", () => {
    expect(significantWords("Câble BT 4x70 mm² câble")).toEqual(["cable", "bt", "4x70"]);
  });

  it("is empty for wording made only of glue", () => {
    expect(significantWords("de la pour")).toEqual([]);
    expect(significantWords("")).toEqual([]);
  });
});

describe("chooseCost — the previous offer", () => {
  it("is the third choice, after anything gathered for this enquiry", () => {
    const withQuote = chooseCost({
      sourced: [],
      quoted: [{ id: "q1", price: "4200", supplierName: "Ets X", isVerbal: false }],
      previous: [{ unitCost: "4000", number: "PF-2026-0001" }],
    });
    expect(withQuote?.costSource).toBe("supplier_quote");
    expect(withQuote?.unitCost).toBe("4200");
  });

  it("takes the NEWEST previous cost, not the cheapest, and names the offer it came from", () => {
    const chosen = chooseCost({
      sourced: [],
      quoted: [],
      previous: [
        { unitCost: null, number: "PF-2026-0009" },
        { unitCost: "4100", number: "PF-2026-0007" },
        { unitCost: "3900", number: "PF-2026-0002" },
      ],
    });
    expect(chosen).toEqual({
      unitCost: "4100",
      costSource: "previous_offer",
      costQuoteId: null,
      supplierName: "PF-2026-0007",
    });
  });

  it("carries nothing from an offer that had no cost itself", () => {
    expect(
      chooseCost({ sourced: [], quoted: [], previous: [{ unitCost: "0", number: "PF-1" }] }),
    ).toBeNull();
    expect(chooseCost({ sourced: [], quoted: [] })).toBeNull();
  });
});
