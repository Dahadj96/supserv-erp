import { describe, expect, it } from "vitest";
import {
  type MatchLine,
  matchLine,
  safeToPayNow,
  threeWayMatch,
  VERDICTS,
} from "@/domain/purchase/match";

/**
 * Screen 68 decides whether SUPSERV pays a supplier. That is the reason every
 * branch here is exercised: the arithmetic is small, and it is the last thing
 * between a repriced line and money leaving the company.
 *
 * The case the whole screen was drawn around is at the bottom - the frame's own
 * numbers, five lines, 42 000 DZD of unexplained difference.
 */

function line(over: Partial<MatchLine> = {}): MatchLine {
  return {
    position: 1,
    designation: "Vanne papillon DN80 PN16",
    unit: "pc",
    orderedQty: "12",
    orderedUnitCost: "38400",
    receivedQty: "12",
    invoicedQty: "12",
    invoicedUnitCost: "38400",
    ...over,
  };
}

describe("one line, against what arrived and what was billed", () => {
  it("is complete when everything ordered arrived", () => {
    expect(matchLine(line()).state).toBe("complete");
    expect(matchLine(line()).remainingQty).toBe("0");
  });

  it("is partial when some arrived, and says how much is left", () => {
    const row = matchLine(line({ orderedQty: "60", receivedQty: "40" }));
    expect(row.state).toBe("partial");
    expect(row.remainingQty).toBe("20");
  });

  it("is awaiting when nothing arrived", () => {
    expect(matchLine(line({ orderedQty: "40", receivedQty: "0" })).state).toBe("awaiting");
  });

  it("never reports a negative remainder when a supplier over-delivers", () => {
    // "Remaining -20" is the kind of number that costs a panel its credibility.
    const row = matchLine(line({ orderedQty: "12", receivedQty: "14" }));
    expect(row.state).toBe("over");
    expect(row.remainingQty).toBe("0");
  });

  it("prints a whole quantity without trailing zeros, and a fraction with them", () => {
    expect(matchLine(line({ orderedQty: "1000", receivedQty: "0" })).remainingQty).toBe("1000");
    expect(matchLine(line({ orderedQty: "1.5", receivedQty: "0" })).remainingQty).toBe("1.5");
  });

  it("says nothing about price on a line the supplier has not billed", () => {
    const row = matchLine(line({ invoicedQty: null, invoicedUnitCost: null }));
    expect(row.price).toBeNull();
    expect(row.priceDifference).toBeNull();
  });

  it("matches a line billed at the price that was quoted", () => {
    expect(matchLine(line()).price).toBe("matches");
    expect(matchLine(line()).priceDifference).toBe("0.00");
  });

  it("values a repriced line on what was BILLED, not on what was ordered", () => {
    // 40 ordered, 10 billed at 1 050 over: the supplier is asking for 10 500,
    // not 42 000. Overstating a difference nobody has asked for yet would send
    // somebody to argue about money that is not on any invoice.
    const row = matchLine(line({ orderedQty: "40", invoicedQty: "10", invoicedUnitCost: "39450" }));
    expect(row.price).toBe("doesNotMatch");
    expect(row.priceDifference).toBe("10500.00");
  });

  it("reports a supplier who billed BELOW the quote as not matching either", () => {
    // Not "matches", and not silence. A price that moved in our favour is
    // still a price nobody agreed to, and it is usually the wrong article.
    const row = matchLine(line({ invoicedUnitCost: "30000" }));
    expect(row.price).toBe("doesNotMatch");
    expect(Number(row.priceDifference)).toBeLessThan(0);
  });
});

describe("the order as a whole", () => {
  it("matches when everything was ordered, arrived and was billed the same", () => {
    const match = threeWayMatch([
      line(),
      line({ position: 2, orderedQty: "8", receivedQty: "8", invoicedQty: "8" }),
    ]);
    expect(match.quantity.verdict).toBe("matches");
    expect(match.total.verdict).toBe("matches");
    expect(match.held).toBe("0.00");
    expect(match.clean).toBe(true);
  });

  it("calls a partial delivery billed correctly EXPLAINED, not a mismatch", () => {
    // The single most common shape on this screen. Painting it red would teach
    // people to click past the row that matters.
    const match = threeWayMatch([line({ orderedQty: "60", receivedQty: "40", invoicedQty: "40" })]);
    expect(match.quantity.verdict).toBe("explained");
    expect(match.clean).toBe(true);
  });

  it("refuses to explain an invoice for more than arrived", () => {
    const match = threeWayMatch([line({ orderedQty: "60", receivedQty: "40", invoicedQty: "60" })]);
    expect(match.quantity.verdict).toBe("doesNotMatch");
    expect(match.clean).toBe(false);
  });

  it("does not call the total a match when the full order was billed before it arrived", () => {
    // The invoice equals the purchase order to the dinar. Judging the total by
    // that alone would have the screen agreeing with a supplier who has
    // delivered nothing.
    const match = threeWayMatch([line({ receivedQty: "0", invoicedQty: "12" })]);
    expect(match.total.ordered).toBe(match.total.invoiced);
    expect(match.total.verdict).toBe("explained");
  });

  it("holds only what is asked above what was agreed", () => {
    const match = threeWayMatch([
      line(),
      line({ position: 2, invoicedUnitCost: "30000" }), // billed BELOW
      line({
        position: 3,
        orderedUnitCost: "2610",
        invoicedUnitCost: "3660",
        orderedQty: "40",
        receivedQty: "0",
        invoicedQty: "40",
      }),
    ]);
    // A supplier billing under the quote is a question, not money to withhold.
    expect(match.held).toBe("42000.00");
  });

  it("never invents a verdict the screen has no label for", () => {
    const cases: MatchLine[][] = [
      [],
      [line()],
      [line({ invoicedQty: null, invoicedUnitCost: null })],
      [line({ receivedQty: "0", invoicedQty: "0", invoicedUnitCost: "0" })],
      [line({ orderedQty: "0", receivedQty: "0", invoicedQty: "0" })],
    ];
    for (const lines of cases) {
      const match = threeWayMatch(lines);
      expect(VERDICTS).toContain(match.quantity.verdict);
      expect(VERDICTS).toContain(match.total.verdict);
    }
  });

  it("has something to say about an order with no lines at all", () => {
    const match = threeWayMatch([]);
    expect(match.total.ordered).toBe("0.00");
    expect(match.clean).toBe(true);
  });
});

describe("what may be paid today", () => {
  it("takes the held amount off before anything else", () => {
    expect(safeToPayNow({ invoiced: "1043700", paid: "500850", held: "42000" })).toBe("500850.00");
  });

  it("is the whole outstanding balance when nothing is held", () => {
    expect(safeToPayNow({ invoiced: "1001700", paid: "500850", held: "0" })).toBe("500850.00");
  });

  it("never goes below zero, however much is held", () => {
    // An overpaid, disputed invoice must read "nothing to pay", never a
    // negative that looks like the supplier owes us a refund we have not asked
    // for.
    expect(safeToPayNow({ invoiced: "100", paid: "100", held: "50" })).toBe("0.00");
  });
});

describe("the frame's own order, PO-2026-0034", () => {
  // Five lines, 140 ordered, 120 received, 120 invoiced, and line 5 billed at
  // 3 660 against a quote of 2 610 having never arrived.
  const order: MatchLine[] = [
    {
      position: 1,
      designation: "Vanne papillon DN80 PN16",
      unit: "pc",
      orderedQty: "12",
      orderedUnitCost: "38400",
      receivedQty: "12",
      invoicedQty: "12",
      invoicedUnitCost: "38400",
    },
    {
      position: 2,
      designation: "Vanne papillon DN100 PN16",
      unit: "pc",
      orderedQty: "8",
      orderedUnitCost: "41100",
      receivedQty: "8",
      invoicedQty: "8",
      invoicedUnitCost: "41100",
    },
    {
      position: 3,
      designation: "Boulonnerie M16 galvanisée",
      unit: "lot",
      orderedQty: "20",
      orderedUnitCost: "2300",
      receivedQty: "20",
      invoicedQty: "20",
      invoicedUnitCost: "2300",
    },
    {
      position: 4,
      designation: "Joint EPDM DN80",
      unit: "pc",
      orderedQty: "60",
      orderedUnitCost: "340",
      receivedQty: "40",
      invoicedQty: "40",
      invoicedUnitCost: "340",
    },
    {
      position: 5,
      designation: 'Raccord bride 2" galvanisé',
      unit: "pc",
      orderedQty: "40",
      orderedUnitCost: "2610",
      receivedQty: "0",
      invoicedQty: "40",
      invoicedUnitCost: "3660",
    },
  ];

  const match = threeWayMatch(order);

  /**
   * THE FRAME'S OWN TOTALS DO NOT ADD UP, and this is where that is recorded.
   *
   * Its match panel prints "Ordered 140 units · Received 120 · Invoiced 120"
   * and "Ordered 1 001 700 · Invoiced 1 043 700". Add the five rows of its own
   * line table and you get 140 ordered — right — but 80 received, because line
   * 5 is drawn as "Received 0 · Awaiting" three inches above. And the ordered
   * value comes to 960 400, not 1 001 700.
   *
   * Mockup figures are typed, not computed. This screen exists to catch numbers
   * that disagree with each other, so it would be a poor joke to seed it with
   * some. The line table is taken as the truth and the totals are derived from
   * it.
   *
   * What DOES survive is the number the whole screen is about: the difference.
   * 42 000 DZD, on line 5, exactly as the banner says — because a difference is
   * arithmetic on two figures that were typed together.
   */
  it("reads the quantities off the line table, not off the frame's summary", () => {
    expect(match.quantity.ordered).toBe("140");
    expect(match.quantity.received).toBe("80");
    expect(match.quantity.invoiced).toBe("120");
  });

  it("derives both totals from the lines", () => {
    expect(match.total.ordered).toBe("960400.00");
    expect(match.total.invoiced).toBe("995600.00");
  });

  it("does not confuse the gap between the totals with what is held", () => {
    // The totals differ by 35 200; the held amount is 42 000. Both are right.
    // Line 5 is billed 1 050 over on 40 units — 42 000 — while line 4 is billed
    // for the 40 that arrived instead of the 60 ordered, which takes 6 800 back
    // off the total and is not a dispute at all.
    //
    // A screen that quoted the difference between two totals as the amount in
    // question would understate this one by 6 800 and would call a partial
    // delivery a discount. They are separate figures and stay separate.
    const gap = Number(match.total.invoiced) - Number(match.total.ordered);
    expect(gap).toBe(35_200);
    expect(match.held).toBe("42000.00");
  });

  it("holds exactly the 42 000 the banner names", () => {
    expect(match.held).toBe("42000.00");
    expect(match.clean).toBe(false);
  });

  it("puts the disagreement on line 5 and nowhere else", () => {
    const wrong = match.lines.filter((l) => l.price === "doesNotMatch").map((l) => l.position);
    expect(wrong).toEqual([5]);
  });

  it("marks line 4 short and line 5 as never arrived", () => {
    expect(match.lines[3]?.state).toBe("partial");
    expect(match.lines[3]?.remainingQty).toBe("20");
    expect(match.lines[4]?.state).toBe("awaiting");
  });

  it("takes the 42 000 off before saying what is safe to pay", () => {
    expect(safeToPayNow({ invoiced: match.total.invoiced, paid: "500000", held: match.held })).toBe(
      "453600.00",
    );
  });
});
