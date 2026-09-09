import { describe, expect, it } from "vitest";
import { type DealCheckFacts, dealChecks, nextStep } from "@/domain/deal/checks";

/**
 * Screen 06's next-step panel (task 2.5).
 *
 * Two properties matter more than any individual sentence. **Order**, because
 * the whole point is that one line names the thing actually waiting on
 * somebody, and a panel that reordered itself each load would be the eight
 * cards again with a border round them. And **details**, because the sentences
 * are ICU `select` and `plural`: a check that carried its argument only when it
 * passed would crash the deal page on exactly the deals the panel exists for.
 */

const facts = (over: Partial<DealCheckFacts> = {}): DealCheckFacts => ({
  dealId: "d-1",
  open: true,
  decision: null,
  lostAt: null,
  lineCount: 0,
  suppliersAsked: 0,
  offersIssued: 0,
  ordersReceived: 0,
  invoicesIssued: 0,
  deadlineAt: new Date("2026-10-01T09:00:00Z"),
  offersDrafted: 0,
  draftOfferId: null,
  ...over,
});

describe("screen 06 — what happens next", () => {
  it("names the decision first on an enquiry nobody has looked at", () => {
    const next = nextStep(dealChecks(facts()));

    expect(next?.key).toBe("decision");
    expect(next?.state).toBe("block");
    expect(next?.fixHref).toBe("/deals/d-1#decision");
  });

  it("asks for the lines once the decision is made", () => {
    const next = nextStep(dealChecks(facts({ decision: "pursue" })));

    expect(next?.key).toBe("lines");
    expect(next?.fixHref).toBe("/deals/d-1/items");
  });

  it("asks for an offer once there are lines", () => {
    // Sourcing warns and the offer blocks, so the offer is what is named.
    const next = nextStep(dealChecks(facts({ decision: "pursue", lineCount: 12 })));

    expect(next?.key).toBe("offer");
    expect(next?.state).toBe("block");
    expect(next?.fixHref).toBe("/deals/d-1#offer");
  });

  it("sends you to the draft rather than to a form that makes a second one", () => {
    // LAW 5: a draft is not an offer out, so this deal still has something
    // waiting — and the thing waiting is that draft.
    const checks = dealChecks(
      facts({ decision: "pursue", lineCount: 3, offersDrafted: 1, draftOfferId: "o-9" }),
    );

    expect(checks.find((c) => c.key === "offer")?.fixHref).toBe("/offers/o-9/build");
  });

  it("stops nagging about suppliers once an offer exists", () => {
    const withOffer = dealChecks(
      facts({ decision: "pursue", lineCount: 3, offersDrafted: 1, draftOfferId: "o-9" }),
    );
    const without = dealChecks(facts({ decision: "pursue", lineCount: 3 }));

    expect(withOffer.map((c) => c.key)).not.toContain("suppliers");
    expect(without.map((c) => c.key)).toContain("suppliers");
  });

  it("calls waiting on the client a fact and not a failure", () => {
    // The same reasoning screen 12 gives "proof of submission — pending".
    const checks = dealChecks(
      facts({ decision: "pursue", lineCount: 3, offersIssued: 1, offersDrafted: 1 }),
    );

    const answer = checks.find((c) => c.key === "clientAnswer");
    expect(answer?.state).toBe("note");
    expect(checks.every((c) => c.state !== "block")).toBe(true);
    expect(nextStep(checks)?.key).toBe("clientAnswer");
  });

  it("warns that an order has not been invoiced, and offers no link to guess with", () => {
    // A facture is made FROM a document, and the deal does not know which one.
    const checks = dealChecks(
      facts({ decision: "pursue", lineCount: 3, offersIssued: 1, ordersReceived: 1 }),
    );

    const invoice = checks.find((c) => c.key === "invoice");
    expect(invoice?.state).toBe("warn");
    expect(invoice?.fixHref).toBeUndefined();
  });

  it("warns about a missing deadline without blocking on it", () => {
    const checks = dealChecks(facts({ decision: "pursue", lineCount: 3, deadlineAt: null }));
    const deadline = checks.find((c) => c.key === "deadline");

    expect(deadline?.state).toBe("warn");
    // There is no /deals/[id]/edit in this application. Pointing at a screen
    // that cannot set it would be worse than naming the gap.
    expect(deadline?.fixHref).toBeUndefined();
  });

  it("says one line about a closed deal rather than a list of failures", () => {
    /*
      Won, lost or walked away from: every check would report something missing
      and all of it would be true and none of it anything to do.
    */
    for (const [over, how] of [
      [{ ordersReceived: 1 }, "won"],
      [{ lostAt: new Date() }, "lost"],
      [{ decision: "no_bid" as const }, "noBid"],
    ] as const) {
      const checks = dealChecks(facts({ open: false, ...over }));
      expect(checks).toHaveLength(1);
      expect(checks[0]?.key).toBe("closed");
      expect(checks[0]?.detail?.how).toBe(how);
    }
  });

  it("never emits a plural or select check without the argument its sentence names", () => {
    /*
      The crash this prevents is specific: `deals.check.decision` is an ICU
      `select` on `decision` and `deals.check.lines` a `plural` on `n`, and
      next-intl throws rather than degrading when the argument is absent. So
      the panel would have failed on precisely the deals it was built for —
      the ones with nothing decided and no lines.
    */
    const needsArg: Record<string, string> = {
      closed: "how",
      decision: "decision",
      lines: "n",
      offer: "drafts",
    };

    const everyShape = [
      facts(),
      facts({ decision: "pursue" }),
      facts({ decision: "pursue", lineCount: 4 }),
      facts({ decision: "pursue", lineCount: 4, offersDrafted: 2 }),
      facts({ decision: "pursue", lineCount: 4, offersIssued: 1 }),
      facts({ decision: "pursue", lineCount: 4, offersIssued: 1, ordersReceived: 1 }),
      facts({ open: false, ordersReceived: 1 }),
      facts({ open: false, lostAt: new Date() }),
    ];

    for (const shape of everyShape) {
      for (const check of dealChecks(shape)) {
        const arg = needsArg[check.key];
        if (!arg) continue;
        expect(check.detail?.[arg], `${check.key} on ${JSON.stringify(shape)}`).toBeDefined();
      }
    }
  });

  it("orders a blocker before a warning before a note", () => {
    const checks = dealChecks(facts({ decision: "pursue", lineCount: 0, deadlineAt: null }));

    expect(nextStep(checks)?.state).toBe("block");
    expect(checks.some((c) => c.state === "warn")).toBe(true);
  });

  it("has nothing to name once the client has ordered and been invoiced", () => {
    const checks = dealChecks(
      facts({
        decision: "pursue",
        lineCount: 3,
        suppliersAsked: 2,
        offersIssued: 1,
        offersDrafted: 1,
        ordersReceived: 1,
        invoicesIssued: 1,
      }),
    );

    expect(nextStep(checks)).toBeNull();
    // And it still lists what passed: a panel that only names problems teaches
    // people that opening it is bad news.
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((c) => c.state === "pass")).toBe(true);
  });
});
