import { describe, expect, it } from "vitest";
import {
  type LinePrices,
  OUTCOMES,
  outcomeOf,
  priceHistory,
  pricePosition,
  type QuoteFact,
  type ResponseFact,
  scorecard,
} from "@/domain/scorecard/supplier";

/**
 * Screen 23 — the supplier scorecard, which stores nothing.
 *
 * The figure that carries the most weight is the reply rate, and the way to get
 * it wrong is to count a bounced message as a supplier who ignored us. Screen
 * 67 already refuses to make that mistake; this is the third place in the
 * system that has to, and the first test below is why.
 */

const ASKED = new Date("2026-08-10T09:00:00Z");

function fact(over: Partial<ResponseFact> = {}): ResponseFact {
  return {
    responseId: "r1",
    requestRef: "SR-2026-0018",
    dealRef: "ENQ-2026-0141",
    askedAt: ASKED,
    repliedAt: new Date("2026-08-12T09:00:00Z"),
    status: "quoted",
    lines: 5,
    won: null,
    used: true,
    weNoBid: false,
    ...over,
  };
}

describe("a bounce is not a silence", () => {
  it("keeps a bounced message out of the reply rate entirely", () => {
    // Ten bounces to a dead address would otherwise read as a 9 % reply rate
    // and condemn a supplier for our own stale contact record.
    const card = scorecard([
      fact(),
      ...Array.from({ length: 9 }, (_, i) =>
        fact({ responseId: `b${i}`, status: "bounced", repliedAt: null }),
      ),
    ]);
    expect(card.asked).toBe(1);
    expect(card.replied).toBe(1);
    expect(card.replyRate).toBe(100);
    expect(card.bounced).toBe(9);
  });

  it("counts a real silence against them", () => {
    const card = scorecard([
      fact(),
      fact({ responseId: "s", status: "no_reply", repliedAt: null }),
    ]);
    expect(card.replyRate).toBe(50);
  });

  it("ignores a request that was never actually sent", () => {
    const card = scorecard([fact({ askedAt: null, repliedAt: null, status: "asked" })]);
    expect(card.asked).toBe(0);
    expect(card.replyRate).toBeNull();
  });

  it("floors the rate rather than flattering it", () => {
    // 2 of 3 is 66.67
    const card = scorecard([
      fact(),
      fact({ responseId: "b" }),
      fact({ responseId: "c", status: "no_reply", repliedAt: null }),
    ]);
    expect(card.replyRate).toBe(66);
  });
});

describe("turnaround", () => {
  it("averages the days from asked to replied", () => {
    const card = scorecard([
      fact({ repliedAt: new Date("2026-08-11T09:00:00Z") }),
      fact({ responseId: "b", repliedAt: new Date("2026-08-13T09:00:00Z") }),
    ]);
    expect(card.turnaroundDays).toBe(2);
  });

  it("says nothing when nobody has ever replied", () => {
    expect(scorecard([fact({ status: "no_reply", repliedAt: null })]).turnaroundDays).toBeNull();
  });

  it("ignores a reply recorded before the ask, rather than averaging a negative", () => {
    const card = scorecard([
      fact({ repliedAt: new Date("2026-08-01T09:00:00Z") }),
      fact({ responseId: "b", repliedAt: new Date("2026-08-12T09:00:00Z") }),
    ]);
    expect(card.turnaroundDays).toBe(2);
  });
});

describe("win rate as our source", () => {
  it("counts only enquiries their price was actually used on", () => {
    const card = scorecard([
      fact({ used: true, won: true }),
      fact({ responseId: "b", used: true, won: false }),
      // Quoted, not used: their price has nothing to do with this outcome.
      fact({ responseId: "c", used: false, won: false }),
    ]);
    expect(card.offersWithTheirPrice).toBe(2);
    expect(card.wonWithTheirPrice).toBe(1);
    expect(card.winRate).toBe(50);
  });

  it("leaves an undecided enquiry out of both halves", () => {
    // An open enquiry is not a loss, and counting it as one would make every
    // supplier look worse the busier the month was.
    const card = scorecard([fact({ used: true, won: null })]);
    expect(card.offersWithTheirPrice).toBe(0);
    expect(card.winRate).toBeNull();
  });
});

describe("when we last asked them", () => {
  it("names the most recent enquiry", () => {
    const card = scorecard([
      fact({ askedAt: new Date("2026-06-01T09:00:00Z"), dealRef: "ENQ-2026-0119" }),
      fact({ responseId: "b", askedAt: ASKED, dealRef: "ENQ-2026-0141" }),
    ]);
    expect(card.lastAskedRef).toBe("ENQ-2026-0141");
    expect(card.lastAskedAt).toEqual(ASKED);
  });

  it("falls back to the sourcing reference when the enquiry has none", () => {
    expect(scorecard([fact({ dealRef: null })]).lastAskedRef).toBe("SR-2026-0018");
  });

  it("says nothing about a supplier we have never asked", () => {
    const card = scorecard([]);
    expect(card.lastAskedAt).toBeNull();
    expect(card.replyRate).toBeNull();
    expect(card.winRate).toBeNull();
  });
});

describe("what happened on one request", () => {
  it("tells a bounce, a silence and a refusal apart", () => {
    expect(outcomeOf(fact({ status: "bounced", repliedAt: null }))).toBe("bounced");
    expect(outcomeOf(fact({ status: "no_reply", repliedAt: null }))).toBe("noReply");
    expect(outcomeOf(fact({ status: "declined", repliedAt: null }))).toBe("declined");
  });

  it("says waiting while the answer could still arrive", () => {
    expect(outcomeOf(fact({ status: "asked", repliedAt: null }))).toBe("waiting");
  });

  it("does not blame a supplier for an enquiry we walked away from", () => {
    expect(outcomeOf(fact({ weNoBid: true }))).toBe("weNoBid");
  });

  it("separates a price we did not use from one that lost", () => {
    expect(outcomeOf(fact({ used: false }))).toBe("notBestPrice");
    expect(outcomeOf(fact({ used: true, won: false }))).toBe("offerLost");
    expect(outcomeOf(fact({ used: true, won: true }))).toBe("offerWon");
  });

  it("never invents an outcome the screen has no label for", () => {
    for (const one of [
      fact(),
      fact({ status: "bounced" }),
      fact({ status: "asked", repliedAt: null }),
      fact({ used: false, won: null }),
      fact({ weNoBid: true, used: false }),
    ]) {
      expect(OUTCOMES).toContain(outcomeOf(one));
    }
  });
});

describe("the price history", () => {
  function quote(over: Partial<QuoteFact> = {}): QuoteFact {
    return {
      reference: "VP-DN80-16",
      designation: "Vanne papillon DN80",
      quotedAt: new Date("2026-08-16T00:00:00Z"),
      unitPrice: "38400",
      ...over,
    };
  }

  it("shows the last price and the one before it, with the movement", () => {
    const rows = priceHistory([
      quote(),
      quote({ quotedAt: new Date("2026-06-12T00:00:00Z"), unitPrice: "36200" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.unitPrice).toBe("38400");
    expect(rows[0]?.previous).toBe("36200");
    expect(rows[0]?.changePct).toBe(6.1);
    expect(rows[0]?.timesQuoted).toBe(2);
  });

  it("does not split an article the supplier renamed halfway through the year", () => {
    // Same reference, different words. A history that split them would show a
    // first-ever quote every time somebody edited a designation.
    const rows = priceHistory([
      quote({ designation: "Vanne papillon DN80 PN16" }),
      quote({ quotedAt: new Date("2026-06-12T00:00:00Z"), unitPrice: "36200" }),
    ]);
    expect(rows).toHaveLength(1);
  });

  it("falls back to the designation when they quote no reference", () => {
    const rows = priceHistory([
      quote({ reference: null }),
      quote({ reference: null, quotedAt: new Date("2026-06-12T00:00:00Z"), unitPrice: "36200" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reference).toBeNull();
  });

  it("says nothing about the movement on a first quote", () => {
    const rows = priceHistory([quote()]);
    expect(rows[0]?.previous).toBeNull();
    expect(rows[0]?.changePct).toBeNull();
  });

  it("does not divide by a previous price of nought", () => {
    const rows = priceHistory([
      quote(),
      quote({ quotedAt: new Date("2026-06-12T00:00:00Z"), unitPrice: "0" }),
    ]);
    expect(rows[0]?.changePct).toBeNull();
  });

  it("drops a quote with neither a reference nor a designation", () => {
    expect(priceHistory([quote({ reference: null, designation: null })])).toEqual([]);
  });

  it("puts the most recently quoted article first", () => {
    const rows = priceHistory([
      quote({ reference: "A", quotedAt: new Date("2026-03-01T00:00:00Z") }),
      quote({ reference: "B", quotedAt: new Date("2026-08-16T00:00:00Z") }),
    ]);
    expect(rows.map((r) => r.reference)).toEqual(["B", "A"]);
  });
});

describe("price position", () => {
  const lines: LinePrices[] = [
    { dealLineId: "1", byParty: { us: "100", them: "120" } },
    { dealLineId: "2", byParty: { us: "200", them: "150" } },
    { dealLineId: "3", byParty: { us: "300", them: "300" } },
    // Nobody else quoted this one.
    { dealLineId: "4", byParty: { us: "50" } },
  ];

  it("counts only lines where somebody else also quoted", () => {
    // Being the cheapest of one is not a price position, and counting it gives
    // a sole supplier a perfect record for never having been compared.
    const position = pricePosition(lines, "us");
    expect(position.compared).toBe(3);
  });

  it("counts a tie as best on both sides", () => {
    expect(pricePosition(lines, "us").best).toBe(2);
    expect(pricePosition(lines, "them").best).toBe(2);
  });

  it("ignores a line this supplier did not price", () => {
    const position = pricePosition([{ dealLineId: "1", byParty: { a: "10", b: "20" } }], "us");
    expect(position).toEqual({ best: 0, compared: 0 });
  });

  it("ignores a nil price rather than calling it the cheapest", () => {
    const position = pricePosition(
      [{ dealLineId: "1", byParty: { us: "0", them: "120", other: "130" } }],
      "us",
    );
    expect(position.best).toBe(0);
  });
});
