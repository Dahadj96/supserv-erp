import { describe, expect, it } from "vitest";
import {
  type BpuLine,
  bpuTotals,
  CHANGES,
  diffBpu,
  keepsItsPrice,
  material,
  type PricedLine,
  priceDrift,
  readLine,
  summarise,
} from "@/domain/tender/bpu";

/**
 * Screen 42 — the BPU and its erratum.
 *
 * The situation the whole file exists for: forty-two lines imported from the
 * client's spreadsheet, thirty-one of them priced, and a fortnight before the
 * deadline the buyer issues an erratum. Re-importing is correct and throws away
 * every price; ignoring it means submitting against the wrong quantities.
 *
 * So the incoming file is diffed against what is held, and the diff is what a
 * person reviews.
 */

function line(over: Partial<BpuLine> = {}): BpuLine {
  return {
    position: 1,
    reference: "VP-DN80-16",
    designation: "Fourniture et pose vanne DN80",
    unit: "ml",
    qty: "1200",
    ...over,
  };
}

describe("what an erratum changed", () => {
  it("says nothing about a line that did not move", () => {
    const changes = diffBpu([line()], [line()]);
    expect(changes[0]?.kind).toBe("unchanged");
    expect(material(changes)).toEqual([]);
  });

  it("reports a quantity change with both figures", () => {
    const changes = diffBpu(
      [line({ position: 12, qty: "1000" })],
      [line({ position: 12, qty: "1400" })],
    );
    expect(changes[0]?.kind).toBe("quantityChanged");
    expect(changes[0]?.from).toBe("1000");
    expect(changes[0]?.to).toBe("1400");
  });

  it("reports a reworded line as reworded, not as a delete and an add", () => {
    // The line number is the identity. Matching on words would lose the price
    // attached to line 18 and report two changes where there is one.
    const changes = diffBpu(
      [line({ position: 18, designation: "Coffret de comptage" })],
      [line({ position: 18, designation: "Coffret de comptage triphasé" })],
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe("designationChanged");
  });

  it("reports a unit change", () => {
    const changes = diffBpu(
      [line({ position: 27, unit: "ml" })],
      [line({ position: 27, unit: "U" })],
    );
    expect(changes[0]?.kind).toBe("unitChanged");
  });

  it("reports a removal and an addition", () => {
    const changes = diffBpu([line({ position: 33 })], [line({ position: 43 })]);
    expect(changes.map((c) => c.kind)).toEqual(["removed", "added"]);
  });

  it("reports the QUANTITY when a line changed in two ways at once", () => {
    // A screen that said "reworded" while the quantity went from 1 000 to
    // 1 400 would be telling somebody the wrong thing about the money.
    const changes = diffBpu(
      [line({ qty: "1000", designation: "Vanne DN80" })],
      [line({ qty: "1400", designation: "Vanne DN100" })],
    );
    expect(changes[0]?.kind).toBe("quantityChanged");
  });

  it("does not call a difference in spacing or case a change", () => {
    const changes = diffBpu(
      [line({ designation: "Vanne papillon DN80", unit: "ML" })],
      [line({ designation: "  vanne papillon dn80 ", unit: "ml" })],
    );
    expect(changes[0]?.kind).toBe("unchanged");
  });

  it("does not call 1000 and 1000.00 a change", () => {
    expect(diffBpu([line({ qty: "1000" })], [line({ qty: "1000.00" })])[0]?.kind).toBe("unchanged");
  });

  it("keeps the client's own line order", () => {
    const changes = diffBpu(
      [line({ position: 3 }), line({ position: 1 })],
      [line({ position: 2 }), line({ position: 1 })],
    );
    expect(changes.map((c) => c.position)).toEqual([1, 2, 3]);
  });

  it("never invents a change the screen has no label for", () => {
    const changes = diffBpu(
      [line({ position: 1 }), line({ position: 2, qty: "5" }), line({ position: 3 })],
      [line({ position: 1 }), line({ position: 2, qty: "6" }), line({ position: 4 })],
    );
    for (const change of changes) expect(CHANGES).toContain(change.kind);
  });
});

describe("which prices survive it", () => {
  it("keeps the price when only the quantity moved", () => {
    // The unit price of a valve does not depend on how many the client wants,
    // and making somebody re-quote forty lines because a number moved is how a
    // deadline gets missed.
    expect(keepsItsPrice("quantityChanged")).toBe(true);
    expect(keepsItsPrice("unchanged")).toBe(true);
  });

  it("drops the price when the words changed", () => {
    // "Vanne papillon DN80" becoming "DN100" is a different article. The system
    // cannot tell a clarification from a substitution, and guessing in the
    // direction that keeps the old price is the guess that puts a wrong number
    // on a submitted bid.
    expect(keepsItsPrice("designationChanged")).toBe(false);
    expect(keepsItsPrice("unitChanged")).toBe(false);
  });

  it("counts what the review will cost", () => {
    const changes = diffBpu(
      [
        line({ position: 12, qty: "1000" }),
        line({ position: 18, designation: "A" }),
        line({ position: 27, unit: "ml" }),
        line({ position: 33 }),
        line({ position: 40 }),
      ],
      [
        line({ position: 12, qty: "1400" }),
        line({ position: 18, designation: "B" }),
        line({ position: 27, unit: "U" }),
        line({ position: 40 }),
        line({ position: 44 }),
      ],
    );

    expect(summarise(changes)).toEqual({
      added: 1,
      removed: 1,
      repriced: 1,
      losesPrice: 2,
      unchanged: 1,
    });
  });
});

describe("pricing a line", () => {
  function priced(over: Partial<PricedLine> = {}): PricedLine {
    return {
      position: 1,
      reference: "VP-DN80-16",
      designation: "Fourniture et pose vanne DN80",
      unit: "ml",
      qty: "1200",
      lastPaid: "1840",
      cost: "1910",
      ourPrice: "2254",
      awaitingQuote: false,
      ...over,
    };
  }

  it("computes the margin from the cost, never storing it", () => {
    const row = readLine(priced());
    expect(row.state).toBe("priced");
    expect(row.marginPct).toBe(18);
    expect(row.lineTotal).toBe("2704800.00");
  });

  it("tells a line waiting for a supplier from one with no price at all", () => {
    expect(readLine(priced({ ourPrice: null, awaitingQuote: true })).state).toBe("awaitingQuote");
    expect(readLine(priced({ ourPrice: null, awaitingQuote: false })).state).toBe("noPrice");
  });

  it("refuses to call a price with no cost behind it infinitely profitable", () => {
    expect(readLine(priced({ cost: null })).marginPct).toBeNull();
    expect(readLine(priced({ cost: "0" })).marginPct).toBeNull();
  });
});

describe("the totals", () => {
  const rows = [
    readLine({
      position: 1,
      reference: null,
      designation: "A",
      unit: "ml",
      qty: "100",
      lastPaid: "900",
      cost: "1000",
      ourPrice: "1200",
      awaitingQuote: false,
    }),
    readLine({
      position: 2,
      reference: null,
      designation: "B",
      unit: "U",
      qty: "10",
      lastPaid: null,
      cost: "500",
      ourPrice: null,
      awaitingQuote: true,
    }),
    readLine({
      position: 3,
      reference: null,
      designation: "C",
      unit: "U",
      qty: "5",
      lastPaid: null,
      cost: null,
      ourPrice: null,
      awaitingQuote: false,
    }),
  ];

  const totals = bpuTotals(rows, "1");

  it("covers the priced lines and says how many are not", () => {
    // A total over three lines of which two have no price is a total two lines
    // short, and printing it alone invites somebody to submit it.
    expect(totals.lines).toBe(3);
    expect(totals.priced).toBe(1);
    expect(totals.awaitingQuote).toBe(1);
    expect(totals.noPrice).toBe(1);
    expect(totals.totalExcl).toBe("120000.00");
    expect(totals.totalCost).toBe("100000.00");
  });

  it("computes the margin rather than storing it", () => {
    expect(totals.marginAmount).toBe("20000.00");
    expect(totals.marginPct).toBe(20);
  });

  it("works the bid bond off the priced total at the stated percentage", () => {
    expect(totals.caution).toBe("1200.00");
  });

  it("says nothing about a bond when the cahier des charges states no rate", () => {
    expect(bpuTotals(rows, null).caution).toBeNull();
  });

  it("survives a bordereau nobody has priced at all", () => {
    const none = bpuTotals([rows[2] as (typeof rows)[number]], "1");
    expect(none.totalExcl).toBe("0.00");
    expect(none.marginPct).toBeNull();
    expect(none.caution).toBeNull();
  });
});

describe("how far prices have moved since we last bought", () => {
  it("averages the drift across the lines that have a history", () => {
    const rows = [
      readLine({
        position: 1,
        reference: null,
        designation: "A",
        unit: "U",
        qty: "1",
        lastPaid: "100",
        cost: "110",
        ourPrice: null,
        awaitingQuote: false,
      }),
      readLine({
        position: 2,
        reference: null,
        designation: "B",
        unit: "U",
        qty: "1",
        lastPaid: "100",
        cost: "102",
        ourPrice: null,
        awaitingQuote: false,
      }),
    ];
    expect(priceDrift(rows)).toEqual({ pct: 6, lines: 2 });
  });

  it("says nothing rather than nought when nothing has been bought before", () => {
    const rows = [
      readLine({
        position: 1,
        reference: null,
        designation: "A",
        unit: "U",
        qty: "1",
        lastPaid: null,
        cost: "110",
        ourPrice: null,
        awaitingQuote: false,
      }),
    ];
    expect(priceDrift(rows)).toBeNull();
  });
});
