import { describe, expect, it } from "vitest";
import { balance, computeTotals, lineTotalExcl } from "@/domain/money";

describe("money", () => {
  it("does not lose a centime to floating point", () => {
    // 0.1 + 0.2 !== 0.3 in JavaScript. This is why Decimal exists.
    const t = computeTotals([
      { qty: 3, unitPrice: "0.10", vatRate: 19 },
      { qty: 1, unitPrice: "0.20", vatRate: 19 },
    ]);
    expect(t.totalExcl).toBe("0.50");
  });

  it("applies a line discount before VAT", () => {
    expect(lineTotalExcl({ qty: 10, unitPrice: "100", discountPct: 10 }).toFixed(2)).toBe("900.00");
  });

  it("keeps 19% and 9% in separate VAT buckets", () => {
    const t = computeTotals([
      { qty: 1, unitPrice: "1000", vatRate: 19 },
      { qty: 1, unitPrice: "1000", vatRate: 9 },
    ]);
    expect(t.vatByRate["19.00"]).toBe("190.00");
    expect(t.vatByRate["9.00"]).toBe("90.00");
    expect(t.totalIncl).toBe("2280.00");
  });

  it("excludes options from every total", () => {
    const t = computeTotals([
      { qty: 1, unitPrice: "1000", vatRate: 19 },
      { qty: 1, unitPrice: "5000", vatRate: 19, isOption: true },
    ]);
    expect(t.totalExcl).toBe("1000.00");
  });

  it("reduces each VAT base proportionally when a global discount applies", () => {
    const t = computeTotals(
      [{ qty: 1, unitPrice: "1000", vatRate: 19 }],
      { globalDiscountPct: 10 },
    );
    expect(t.totalExcl).toBe("900.00");
    expect(t.vatByRate["19.00"]).toBe("171.00");
  });

  it("adds droit de timbre after VAT", () => {
    const t = computeTotals([{ qty: 1, unitPrice: "1000", vatRate: 0 }], { stampDuty: "40" });
    expect(t.totalIncl).toBe("1040.00");
  });

  it("computes a balance rather than storing one", () => {
    expect(balance("2280.00", "400.00")).toBe("1880.00");
  });
});
