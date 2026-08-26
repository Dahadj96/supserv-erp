import { describe, expect, it } from "vitest";
import {
  applyMarginToAll,
  lineMargin,
  type MarginLine,
  marginPct,
  priceFromMargin,
  summariseMargin,
} from "@/domain/offer/margin";

/**
 * Screen 12's Cost and Margin columns, with the frame's own lines.
 *
 * SUP/OFF/2026/0113, six lines. The SELLING side reconciles exactly: every row
 * total on the frame is right, and they sum to the 1 173 600 its Totals card
 * prints.
 *
 * The COST side does not. The card says 1 001 700, which is the same figure
 * screen 67's summary quotes for Hydro-Equip — and which did not reconcile with
 * that screen's table either. The six lines here cost 995 400, so the margin is
 * 178 200 at 17.9%, not 171 900 at 17.2%.
 *
 * The mockup carries one supplier total across two screens without recomputing
 * it. The arithmetic below follows the LINES, because the lines are the data.
 * Written down so nobody "fixes" the code to match a headline that was never
 * derived from the rows beneath it.
 */
/**
 * `designation` is here for the reader, not for the arithmetic — `MarginLine`
 * has no such field, so the fixtures go through this to keep the names without
 * having a test that would not compile against the real type.
 */
const line = (l: {
  designation: string;
  qty: string | null;
  unitCost: string | null;
  unitPrice: string | null;
  isOption?: boolean;
  lineKind?: string;
}): MarginLine => ({
  qty: l.qty,
  unitCost: l.unitCost,
  unitPrice: l.unitPrice,
  isOption: l.isOption,
  lineKind: l.lineKind,
});

const OFFER = [
  line({ designation: "Vanne papillon DN80", qty: "12", unitCost: "38400", unitPrice: "44900" }),
  line({ designation: "Vanne papillon DN100", qty: "8", unitCost: "41100", unitPrice: "48200" }),
  line({ designation: 'Raccord bride 2"', qty: "40", unitCost: "2610", unitPrice: "3150" }),
  line({ designation: "Joint EPDM DN80", qty: "60", unitCost: "340", unitPrice: "420" }),
  line({ designation: "Boulonnerie M16", qty: "20", unitCost: "2300", unitPrice: "2800" }),
  line({
    designation: "Transport et manutention",
    qty: "1",
    unitCost: "35000",
    unitPrice: "42000",
  }),
];

describe("margin is computed, never stored", () => {
  it("reads the per-line percentages the frame prints", () => {
    // 38 400 → 44 900 is 16.93%, drawn as 17%. 2 610 → 3 150 is 20.69%, drawn
    // as 21%. The frame rounds to whole percents; the arithmetic does not.
    expect(marginPct("38400", "44900")).toBe("16.93");
    expect(marginPct("2610", "3150")).toBe("20.69");
    expect(marginPct("340", "420")).toBe("23.53");
  });

  it("refuses to call a price with no cost behind it infinitely profitable", () => {
    expect(marginPct("0", "44900")).toBeNull();
    expect(marginPct(null, "44900")).toBeNull();
    expect(marginPct("38400", null)).toBeNull();
  });

  it("goes the other way, to the price a margin implies", () => {
    expect(priceFromMargin("38400", "20")).toBe("46080.0000");
    // And back again, exactly.
    expect(marginPct("38400", priceFromMargin("38400", "20"))).toBe("20.00");
  });

  it("reports a loss as a negative rather than hiding it", () => {
    expect(marginPct("1000", "900")).toBe("-10.00");
    expect(lineMargin({ unitCost: "1000", unitPrice: "900", qty: "5" })).toBe("-500.00");
  });
});

describe("the totals card, cost side", () => {
  const summary = summariseMargin(OFFER);

  it("adds up the lines, and matches the frame where the frame adds up", () => {
    // Total HT is the frame's own figure, reached from its own row totals.
    expect(summary.totalExcl).toBe("1173600.00");
    // Cost, margin and percentage follow the lines. See the note at the top.
    expect(summary.totalCost).toBe("995400.00");
    expect(summary.margin).toBe("178200.00");
    expect(summary.marginPct).toBe("17.9");
  });

  it("counts the lines with no cost, because they flatter the headline", () => {
    // The number that keeps the percentage honest. Four lines of six costed
    // shows a margin over those four, and it LOOKS like the margin on the
    // offer — the other two could be sold at a loss and it would not move.
    const partial = summariseMargin([
      ...OFFER.slice(0, 4),
      line({ designation: "Installation", qty: "1", unitCost: null, unitPrice: "80000" }),
      line({ designation: "Mise en service", qty: "1", unitCost: null, unitPrice: "40000" }),
    ]);
    expect(partial.linesWithoutCost).toBe(2);
    // The priced-but-uncosted lines still count towards what the client pays.
    expect(partial.totalExcl).toBe("1195600.00");
  });

  it("counts lines sold at or below cost", () => {
    const summary = summariseMargin([
      line({ designation: "Loss leader", qty: "1", unitCost: "1000", unitPrice: "1000" }),
      line({ designation: "Worse", qty: "1", unitCost: "1000", unitPrice: "900" }),
      line({ designation: "Fine", qty: "1", unitCost: "1000", unitPrice: "1200" }),
    ]);
    expect(summary.linesAtOrBelowCost).toBe(2);
  });

  it("leaves options out, the way the totals do", () => {
    // An option is shown to the client and not sold. Counting its margin
    // inflates a figure somebody is about to make a decision on.
    const withOption = summariseMargin([
      ...OFFER,
      line({
        designation: "Extension",
        qty: "1",
        unitCost: "10000",
        unitPrice: "90000",
        isOption: true,
      }),
    ]);
    expect(withOption.margin).toBe("178200.00");
  });

  it("ignores sections and notes, which carry no money", () => {
    const withHeadings = summariseMargin([
      line({
        designation: "LOT 1",
        qty: null,
        unitCost: null,
        unitPrice: null,
        lineKind: "section",
      }),
      ...OFFER.map((l) => ({ ...l, lineKind: "item" })),
    ]);
    expect(withHeadings.linesWithoutCost).toBe(0);
    expect(withHeadings.margin).toBe("178200.00");
  });
});

describe("apply margin to all lines", () => {
  it("reprices every line that has a cost", () => {
    const applied = applyMarginToAll(OFFER, "25");
    expect(applied[0]?.unitPrice).toBe("48000.0000");
    expect(marginPct(applied[3]?.unitCost ?? null, applied[3]?.unitPrice ?? null)).toBe("25.00");
  });

  it("does not invent a cost in order to have something to mark up", () => {
    // Applying a margin to a costless line would have to make one up, and the
    // made-up number would then sit in the Cost column looking found.
    const applied = applyMarginToAll(
      [line({ designation: "Installation", qty: "1", unitCost: null, unitPrice: "80000" })],
      "25",
    );
    expect(applied[0]?.unitCost).toBeNull();
    expect(applied[0]?.unitPrice).toBe("80000");
  });
});
