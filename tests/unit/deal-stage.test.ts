import { describe, expect, it } from "vitest";
import {
  badgeOf,
  type DealFacts,
  deadlineDisplay,
  isOpen,
  outcomeOf,
  stageOf,
} from "@/domain/deal/stage";

const NOTHING: DealFacts = {
  decision: null,
  lostAt: null,
  lineCount: 0,
  suppliersAsked: 0,
  priceQuotes: 0,
  offersIssued: 0,
  ordersReceived: 0,
  deliveriesIssued: 0,
  invoicesIssued: 0,
};

const facts = (over: Partial<DealFacts>): DealFacts => ({ ...NOTHING, ...over });

describe("stage is computed, never stored", () => {
  it("an enquiry nobody has touched is new", () => {
    expect(stageOf(NOTHING)).toBe("new");
  });

  it("typing in what the client asked for is enough to be qualifying", () => {
    expect(stageOf(facts({ lineCount: 6 }))).toBe("qualifying");
  });

  it("deciding to pursue is enough on its own, before any line exists", () => {
    expect(stageOf(facts({ decision: "pursue" }))).toBe("qualifying");
  });

  it("reads the furthest thing that exists", () => {
    expect(stageOf(facts({ lineCount: 6, suppliersAsked: 4 }))).toBe("sourcing");
    expect(stageOf(facts({ suppliersAsked: 4, offersIssued: 1 }))).toBe("offerOut");
    expect(stageOf(facts({ offersIssued: 1, ordersReceived: 1 }))).toBe("ordered");
    expect(stageOf(facts({ ordersReceived: 1, invoicesIssued: 1 }))).toBe("invoiced");
  });

  it("does not make a delivery a stage of its own", () => {
    /*
      `deliveriesIssued` joined `DealFacts` for screen 06's numbered run (task
      2.6) and deliberately did NOT join the ladder `stageOf` climbs. Plenty of
      won deals are invoiced with no bon de livraison at all — a service has
      nothing to deliver, and goods the client collected leave with a signature
      on somebody's copy — so "delivered" would be a stage most won deals skip,
      and a chip counting it would be a chip nobody could trust.
    */
    expect(stageOf(facts({ ordersReceived: 1, deliveriesIssued: 3 }))).toBe("ordered");
    expect(stageOf(facts({ deliveriesIssued: 3 }))).toBe("new");
    expect(stageOf(facts({ ordersReceived: 1, deliveriesIssued: 3, invoicesIssued: 1 }))).toBe(
      "invoiced",
    );
  });

  it("does not make a price a stage either — asking a supplier is what sourcing means", () => {
    // A price captured at a shop counter is a real price and no supplier was
    // asked for it, so it cannot move an enquiry to `sourcing`. Same reasoning
    // as the delivery above: a fact the run needs is not automatically a rung.
    expect(stageOf(facts({ lineCount: 2, priceQuotes: 5 }))).toBe("qualifying");
  });

  it("does not count a draft offer as an offer out", () => {
    // `offersIssued` counts issued documents. A draft has no number (LAW 5) and
    // the client has never seen it, so the enquiry is still at sourcing.
    expect(stageOf(facts({ suppliersAsked: 2, offersIssued: 0 }))).toBe("sourcing");
  });

  it("keeps the stage of something we walked away from", () => {
    // "Recorded so we can learn from it" only works if you can still see how
    // far it got before the no.
    const walked = facts({ decision: "no_bid", lineCount: 6, suppliersAsked: 3 });
    expect(stageOf(walked)).toBe("sourcing");
    expect(outcomeOf(walked)).toBe("noBid");
  });
});

describe("outcome is read, never ticked", () => {
  it("won is an order arriving, not a checkbox", () => {
    expect(outcomeOf(facts({ ordersReceived: 1 }))).toBe("won");
    expect(outcomeOf(facts({ offersIssued: 3 }))).toBeNull();
  });

  it("lost and no-bid are the two nothing else can tell us", () => {
    expect(outcomeOf(facts({ lostAt: new Date() }))).toBe("lost");
    expect(outcomeOf(facts({ decision: "no_bid" }))).toBe("noBid");
  });

  it("lost beats won, because an order can be cancelled and told to us", () => {
    expect(outcomeOf(facts({ ordersReceived: 1, lostAt: new Date() }))).toBe("lost");
  });

  it("prints the outcome over the stage in the badge column", () => {
    expect(badgeOf(facts({ ordersReceived: 1 }))).toBe("won");
    expect(badgeOf(facts({ suppliersAsked: 2 }))).toBe("sourcing");
  });
});

describe("open, and the deadline column", () => {
  const now = new Date(Date.UTC(2026, 7, 19, 12, 0));

  it("counts as open until something ends it", () => {
    expect(isOpen(facts({ offersIssued: 2 }))).toBe(true);
    expect(isOpen(facts({ ordersReceived: 1 }))).toBe(false);
    expect(isOpen(facts({ decision: "no_bid" }))).toBe(false);
  });

  it("says closed rather than showing a date we no longer care about", () => {
    const deadline = new Date(Date.UTC(2026, 5, 1));
    // Three months overdue, and completely uninteresting — we no-bid it in May.
    expect(deadlineDisplay(facts({ decision: "no_bid" }), deadline, now).kind).toBe("closed");
  });

  it("counts the hours left on a live one", () => {
    const deadline = new Date(Date.UTC(2026, 7, 20, 12, 0));
    const shown = deadlineDisplay(facts({ lineCount: 6 }), deadline, now);
    expect(shown.kind).toBe("at");
    expect(shown.hoursLeft).toBe(24);
  });

  it("goes negative rather than pretending, when a live one is overdue", () => {
    const deadline = new Date(Date.UTC(2026, 7, 18, 12, 0));
    expect(deadlineDisplay(facts({ lineCount: 6 }), deadline, now).hoursLeft).toBe(-24);
  });

  it("says none when the client never gave one", () => {
    expect(deadlineDisplay(facts({ lineCount: 2 }), null, now).kind).toBe("none");
  });
});
