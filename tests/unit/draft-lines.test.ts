import { describe, expect, it } from "vitest";
import { type DraftLine, keepable } from "@/documents/draft";
import { computeTotals } from "@/domain/money";

const line = (over: Partial<DraftLine> = {}): DraftLine => ({
  lineKind: "item",
  designation: "Galets de convoyeur",
  unit: "U",
  qty: "2",
  unitPrice: "1000",
  vatRate: "19",
  ...over,
});

describe("which rows survive a save", () => {
  it("keeps a priced item", () => {
    expect(keepable([line()])).toHaveLength(1);
  });

  it("drops a row nobody typed into", () => {
    expect(keepable([line({ designation: "  " })])).toHaveLength(0);
    expect(keepable([line({ qty: "0" })])).toHaveLength(0);
  });

  it("keeps a section heading, which has no quantity by nature", () => {
    expect(
      keepable([line({ lineKind: "section", designation: "LOT 1 — FOURNITURE" })]),
    ).toHaveLength(1);
  });

  it("keeps a free-text line and a subtotal without asking them for a price", () => {
    const rows: DraftLine[] = [
      line({ lineKind: "text", designation: "Travaux hors heures de production.", qty: null }),
      line({ lineKind: "subtotal", designation: "Sous-total lot 1", qty: null }),
    ];
    expect(keepable(rows)).toHaveLength(2);
  });

  it("keeps a page break, which has nothing on it at all", () => {
    expect(keepable([line({ lineKind: "page_break", designation: "" })])).toHaveLength(1);
  });
});

describe("what an option does to the totals", () => {
  it("is priced, shown, and added to nothing", () => {
    const totals = computeTotals([
      { qty: 2, unitPrice: 1000, vatRate: 19 },
      { qty: 1, unitPrice: 500, vatRate: 19, isOption: true },
    ]);

    expect(totals.totalExcl).toBe("2000.00");
    expect(totals.optionsExcl, "the client can see what they did not buy").toBe("500.00");
    expect(totals.totalIncl).toBe("2380.00");
    expect(totals.vatByRate["19.00"], "an option is not taxed either").toBe("380.00");
  });

  it("counts an option's own discount when reporting it", () => {
    const totals = computeTotals([
      { qty: 1, unitPrice: 1000, vatRate: 19, discountPct: 10, isOption: true },
    ]);
    expect(totals.optionsExcl).toBe("900.00");
    expect(totals.totalExcl).toBe("0.00");
  });
});

describe("an advance already invoiced", () => {
  it("comes off what is due, not off the value of the work", () => {
    const totals = computeTotals([{ qty: 1, unitPrice: 100000, vatRate: 19 }], {
      advanceDeducted: "35700.00",
    });

    // The work is still worth 119 000 TTC — that is what the document says.
    expect(totals.totalIncl).toBe("119000.00");
    // The client pays the rest.
    expect(totals.dueNow).toBe("83300.00");
    expect(totals.advanceDeducted).toBe("35700.00");
  });

  it("leaves due equal to the total when there is no advance", () => {
    const totals = computeTotals([{ qty: 1, unitPrice: 1000, vatRate: 0 }]);
    expect(totals.dueNow).toBe(totals.totalIncl);
  });

  it("does not touch the VAT — an advance was taxed on its own invoice", () => {
    const withAdvance = computeTotals([{ qty: 1, unitPrice: 100000, vatRate: 19 }], {
      advanceDeducted: "50000.00",
    });
    const without = computeTotals([{ qty: 1, unitPrice: 100000, vatRate: 19 }]);

    expect(withAdvance.totalVat).toBe(without.totalVat);
  });
});
