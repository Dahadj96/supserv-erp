import { describe, expect, it } from "vitest";
import { computeCosting, impliedMarginPct } from "@/domain/deal/costing";
import {
  bestFor,
  coverageOf,
  DAYS_UNTIL_A_CLIENT_DECIDES,
  firmnessOf,
  type PriceSource,
  type Quote,
  riskOf,
} from "@/domain/deal/prices";

const AUG = (day: number) => new Date(Date.UTC(2026, 7, day));

let n = 0;
function quote(over: Partial<Quote> & { price: string }): Quote {
  n += 1;
  return {
    id: `q${n}`,
    dealLineId: "line-1",
    itemId: null,
    source: "supplier_email" as PriceSource,
    supplierName: "Sono Alger SARL",
    currency: "DZD",
    isVerbal: false,
    capturedAt: AUG(17),
    capturedPlace: null,
    validUntil: null,
    ...over,
  };
}

describe("how firm a price is", () => {
  it("is written, verbal, or ours", () => {
    expect(firmnessOf({ source: "supplier_email", isVerbal: false })).toBe("written");
    expect(firmnessOf({ source: "shop_visit", isVerbal: true })).toBe("verbal");
    expect(firmnessOf({ source: "supplier_proforma", isVerbal: false })).toBe("written");
    // Our own costing is not a kind of firm. It is a number we are responsible
    // for, and it carries our margin rather than somebody's quote.
    expect(firmnessOf({ source: "internal_costing", isVerbal: false })).toBe("internal");
  });
});

describe("the best price is not simply the lowest", () => {
  const decides = AUG(30);

  it("takes the cheapest when everything is still good", () => {
    const best = bestFor([quote({ price: "18400" }), quote({ price: "17900" })], decides);
    expect(best?.price).toBe("17900");
  });

  it("passes over a cheaper price that will have expired by then", () => {
    // 3% cheaper on a price that runs out next Tuesday is not cheaper. It is a
    // phone call you will make again, under time pressure, in September.
    const best = bestFor(
      [
        quote({ price: "17900", validUntil: AUG(25) }),
        quote({ price: "18400", validUntil: new Date(Date.UTC(2026, 8, 16)) }),
      ],
      decides,
    );
    expect(best?.price).toBe("18400");
  });

  it("still picks one when every price will have expired", () => {
    // Refusing to choose leaves the line blank on the offer, which helps
    // nobody. The expiry is reported separately.
    const best = bestFor(
      [
        quote({ price: "17900", validUntil: AUG(25) }),
        quote({ price: "18400", validUntil: AUG(20) }),
      ],
      decides,
    );
    expect(best?.price).toBe("17900");
  });

  it("has nothing to say about a line with no prices", () => {
    expect(bestFor([], decides)).toBeNull();
  });
});

describe("coverage", () => {
  const lines = ["line-1", "line-2", "line-3", "line-4"];

  it("counts what is priced, what is doubled up, and what is not touched", () => {
    const coverage = coverageOf(lines, [
      quote({ dealLineId: "line-1", price: "100" }),
      quote({ dealLineId: "line-1", price: "90" }),
      quote({ dealLineId: "line-2", price: "50" }),
      quote({ dealLineId: "line-3", price: "20", source: "internal_costing" }),
    ]);

    expect(coverage).toMatchObject({
      items: 4,
      withAnyPrice: 3,
      withTwoOrMore: 1,
      noPriceYet: 1,
      pricedByUs: 1,
    });
  });

  it("calls a line verbal-only when there is nothing written to fall back on", () => {
    const coverage = coverageOf(
      ["a", "b"],
      [
        quote({ dealLineId: "a", price: "10", source: "shop_visit", isVerbal: true }),
        // b has a verbal AND a written price. It is not at risk — it has a document.
        quote({ dealLineId: "b", price: "10", source: "phone", isVerbal: true }),
        quote({ dealLineId: "b", price: "12" }),
      ],
    );
    expect(coverage.verbalOnly).toBe(1);
  });

  it("ignores a catalogue price attached to no line", () => {
    const coverage = coverageOf(["a"], [quote({ dealLineId: null, price: "10" })]);
    expect(coverage.withAnyPrice).toBe(0);
  });
});

describe("what a verbal price costs you", () => {
  const deadline = AUG(24);

  it("counts firm against verbal on the price that would actually be used", () => {
    const risk = riskOf({
      lineIds: ["a", "b", "c"],
      quotes: [
        quote({ dealLineId: "a", price: "100" }),
        quote({ dealLineId: "b", price: "100", source: "shop_visit", isVerbal: true }),
        quote({ dealLineId: "c", price: "100", source: "phone", isVerbal: true }),
      ],
      clientDeadline: deadline,
    });
    expect(risk).toMatchObject({ firm: 1, verbal: 2 });
  });

  it("counts the prices that run out before the client is expected to answer", () => {
    // The one that costs money and that nobody notices: a price valid for a
    // week against a public buyer who opens the envelopes and answers in
    // September.
    const risk = riskOf({
      lineIds: ["a"],
      quotes: [quote({ dealLineId: "a", price: "100", validUntil: AUG(31) })],
      clientDeadline: deadline,
    });
    expect(risk.expiresFirst).toBe(1);
    expect(risk.decidesOnBasis).toBe("clientDeadline");
    expect(risk.decidesOn?.getTime()).toBe(
      deadline.getTime() + DAYS_UNTIL_A_CLIENT_DECIDES * 86_400_000,
    );
  });

  it("claims nothing about expiry when the client gave no deadline", () => {
    // No deadline, no basis for a date, so no claim. Saying "expires before the
    // client decides" without knowing when they decide is a guess wearing a
    // number.
    const risk = riskOf({
      lineIds: ["a"],
      quotes: [quote({ dealLineId: "a", price: "100", validUntil: AUG(20) })],
      clientDeadline: null,
    });
    expect(risk.expiresFirst).toBe(0);
    expect(risk.decidesOn).toBeNull();
    expect(risk.decidesOnBasis).toBe("none");
  });
});

describe("costing a service line, which will never have a supplier", () => {
  // The frame's own numbers: 2 people × 3 days at 6 500, plus 8 000 materials,
  // 14 000 transport, 5 000 contingency. Cost 66 000, margin 30%.
  const SITE_JOB = {
    people: 2,
    days: 3,
    dailyRate: "6500",
    materials: "8000",
    transport: "14000",
    contingency: "5000",
    marginPct: "30",
  };

  it("adds up the way the screen says it does", () => {
    const result = computeCosting(SITE_JOB);
    expect(result.labourCost).toBe("39000.00");
    expect(result.cost).toBe("66000.00");
  });

  it("takes the margin on the cost, not out of the price", () => {
    // The distinction is worth eight thousand dinars at 30%: margin on cost
    // gives 85 800, margin on price would give 94 286.
    const result = computeCosting(SITE_JOB);
    expect(result.margin).toBe("19800.00");
    expect(result.price).toBe("85800.00");
  });

  it("survives blanks and commas, because people type both", () => {
    const result = computeCosting({
      people: 1,
      days: 1,
      dailyRate: "6 500",
      materials: "",
      transport: "1000,50",
      contingency: "",
      marginPct: "",
    });
    // "6 500" has a space in it and is still six and a half thousand.
    expect(result.cost).toBe("7500.50");
    expect(result.margin).toBe("0.00");
  });

  it("reads a margin back out of a price somebody already decided", () => {
    expect(impliedMarginPct("66000", "85800")).toBe("30.00");
  });

  it("refuses to call a price with no cost behind it infinitely profitable", () => {
    expect(impliedMarginPct("0", "85800")).toBeNull();
  });
});
