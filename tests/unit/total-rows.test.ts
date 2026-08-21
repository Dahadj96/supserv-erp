import { describe, expect, it } from "vitest";
import { totalRows } from "@/documents/engine";
import { computeTotals } from "@/domain/money";

/**
 * The totals block used to be `Object.entries(stored).map(...)`. `Totals` has a
 * `vatByRate` object in the middle of it, `Number({})` is NaN, and the first
 * real invoice carrying two VAT rates would have printed "NaN DZD" where the
 * VAT line belongs. This test is that bug, held down.
 */
describe("the totals block", () => {
  const labels = (rows: { label: string }[]) => rows.map((r) => r.label);

  it("shows one line per VAT rate, highest first", () => {
    const totals = computeTotals([
      { qty: 10, unitPrice: 1000, vatRate: 19 },
      { qty: 5, unitPrice: 200, vatRate: 9 },
    ]);
    const rows = totalRows(totals, "fr");

    expect(labels(rows)).toEqual(["totalExcl", "vat:19.00", "vat:9.00", "totalIncl"]);
    expect(rows.every((r) => !r.value.includes("NaN"))).toBe(true);
  });

  it("puts the grand total last and keeps it even at zero", () => {
    const rows = totalRows(computeTotals([]), "fr");
    expect(labels(rows).at(-1)).toBe("totalIncl");
    expect(labels(rows)).toContain("totalExcl");
  });

  it("drops a discount, an advance and a stamp duty of nothing", () => {
    const rows = totalRows(computeTotals([{ qty: 1, unitPrice: 100, vatRate: 19 }]), "fr");
    expect(labels(rows)).not.toContain("discountTotal");
    expect(labels(rows)).not.toContain("stampDuty");
    expect(labels(rows)).not.toContain("advanceDeducted");
  });

  it("keeps a stamp duty that was actually charged", () => {
    const totals = computeTotals([{ qty: 1, unitPrice: 100, vatRate: 19 }], { stampDuty: "40.00" });
    expect(labels(totalRows(totals, "fr"))).toContain("stampDuty");
  });

  it("still reads a record written before VAT was split by rate", () => {
    const rows = totalRows(
      { totalExcl: "1000.00", totalVat: "190.00", totalIncl: "1190.00" },
      "fr",
    );
    expect(labels(rows)).toEqual(["totalExcl", "totalVat", "totalIncl"]);
  });

  it("survives a document whose totals were never computed", () => {
    expect(() => totalRows(null, "fr")).not.toThrow();
    expect(labels(totalRows({}, "fr"))).toEqual(["totalExcl", "totalIncl"]);
  });
});
