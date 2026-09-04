import { describe, expect, it } from "vitest";
import { computeTotals } from "@/domain/money";
import { cumulative, situationRows } from "@/domain/project/situation";

/**
 * The décompte's arithmetic, checked against a marché a person can follow by
 * hand: three prices, two situations already certified, a third being raised.
 */
const CONTRACT = [
  {
    lineId: "l1",
    position: 1,
    reference: "1.1",
    designation: "Fouille en tranchée",
    unit: "m3",
    qty: "400",
    unitPrice: "1200",
    vatRate: "19",
  },
  {
    lineId: "l2",
    position: 2,
    reference: "1.2",
    designation: "Câble BT 4x70",
    unit: "ml",
    qty: "1500",
    unitPrice: "2100",
    vatRate: "19",
  },
  {
    lineId: "l3",
    position: 3,
    reference: "2.1",
    designation: "Poteau béton 9 m",
    unit: "U",
    qty: "20",
    unitPrice: "38000",
    vatRate: "19",
  },
];

describe("situationRows", () => {
  it("adds the period to what the earlier situations claimed, line by line", () => {
    const rows = situationRows({
      contract: CONTRACT,
      previous: { l1: "250", l2: "600" },
      period: { l1: "100", l3: "8" },
    });
    expect(rows.map((r) => [r.qtyPrevious, r.qtyPeriod, r.qtyCumul])).toEqual([
      ["250", "100", "350"],
      ["600", "0", "600"],
      ["0", "8", "8"],
    ]);
    expect(rows[0]?.amountPeriod).toBe("120000.00");
    expect(rows[0]?.amountCumul).toBe("420000.00");
    expect(rows[2]?.amountCumul).toBe("304000.00");
  });

  it("keeps every contract line, claimed or not, in the contract's order", () => {
    const rows = situationRows({
      contract: [...CONTRACT].reverse(),
      previous: {},
      period: { l2: "10" },
    });
    expect(rows.map((r) => r.lineId)).toEqual(["l1", "l2", "l3"]);
    expect(rows[0]?.qtyCumul).toBe("0");
  });

  it("flags a cumulative quantity past the marché's rather than refusing it", () => {
    const rows = situationRows({
      contract: CONTRACT,
      previous: { l3: "18" },
      period: { l3: "4" },
    });
    expect(rows[2]?.qtyCumul).toBe("22");
    expect(rows[2]?.overContract).toBe(true);
    expect(rows[0]?.overContract).toBe(false);
  });

  it("works in decimals, not floats", () => {
    const rows = situationRows({
      contract: [{ ...(CONTRACT[0] as (typeof CONTRACT)[0]), unitPrice: "0.1" }],
      previous: { l1: "0.2" },
      period: { l1: "0.1" },
    });
    expect(rows[0]?.qtyCumul).toBe("0.3");
    expect(rows[0]?.amountCumul).toBe("0.03");
  });
});

describe("cumulative", () => {
  it("prints the certified figure and closes the gap with the period", () => {
    const rows = situationRows({
      contract: CONTRACT,
      previous: { l1: "250", l2: "600" },
      period: { l1: "100", l3: "8" },
    });
    // 250×1200 + 600×2100 = 300 000 + 1 260 000 certified before.
    const c = cumulative({ rows, previouslyCertifiedExcl: "1560000", contractExcl: "4390000" });
    expect(c.cumulExcl).toBe("1984000.00");
    expect(c.previouslyCertifiedExcl).toBe("1560000.00");
    expect(c.periodExcl).toBe("424000.00");
    expect(c.percentOfContract).toBe(45);
    expect(c.overContract).toBe(0);
  });

  it("has no percentage without a contract value", () => {
    const c = cumulative({ rows: [], previouslyCertifiedExcl: "0", contractExcl: null });
    expect(c.percentOfContract).toBeNull();
    expect(c.periodExcl).toBe("0.00");
  });
});

describe("computeTotals — retenue de garantie", () => {
  const lines = [{ qty: "100", unitPrice: "1200", vatRate: "19" }];

  it("withholds nothing until somebody has said what it is taken on", () => {
    const t = computeTotals(lines, { retentionPct: "5" });
    expect(t.retention).toBe("0.00");
    expect(t.dueNow).toBe(t.totalIncl);
  });

  it("takes 5 % of the HT when the CCAP says so, without touching the VAT", () => {
    const t = computeTotals(lines, { retentionPct: "5", retentionBase: "excl" });
    expect(t.totalExcl).toBe("120000.00");
    expect(t.totalVat).toBe("22800.00");
    expect(t.totalIncl).toBe("142800.00");
    expect(t.retention).toBe("6000.00");
    expect(t.dueNow).toBe("136800.00");
  });

  it("takes it on the TTC when the CCAP says that instead", () => {
    const t = computeTotals(lines, { retentionPct: "5", retentionBase: "incl" });
    expect(t.retention).toBe("7140.00");
    expect(t.dueNow).toBe("135660.00");
  });

  it("leaves the droit de timbre out of the TTC base — it is a tax on the payment", () => {
    const t = computeTotals(lines, { retentionPct: "5", retentionBase: "incl", stampDuty: "1000" });
    expect(t.totalIncl).toBe("143800.00");
    expect(t.retention).toBe("7140.00");
  });

  it("comes off what is due together with an advance being recovered", () => {
    const t = computeTotals(lines, {
      retentionPct: "5",
      retentionBase: "excl",
      advanceDeducted: "20000",
    });
    expect(t.dueNow).toBe("116800.00");
  });
});
