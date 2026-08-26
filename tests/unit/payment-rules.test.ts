import { describe, expect, it } from "vitest";
import {
  isInstrument,
  type PaymentShape,
  rulesFor,
  STAMP_DUTY_RULE,
  toCheck,
} from "@/domain/money/instruments";

/**
 * Screen 19's "Rules that apply".
 *
 * The frame prints three claims about Algerian law as settled fact — cash
 * attracts the droit de timbre, a transfer does not, foreign currency requires
 * domiciliation. Screen 69 says this software may not do that:
 *
 *   "The software enforces these rules. It does not assert that they are the
 *   law. Each one names its source and the person who confirmed it — and until
 *   someone does, it is marked unconfirmed and enforced as a warning only."
 *
 * `invoice.stampDutyThreshold` is one of the four rules screen 85 hands to the
 * accountant and nobody has confirmed. So these tests assert the OPPOSITE of
 * the frame in the ordinary case: until somebody confirms the threshold and the
 * rate, the timbre rows say "not confirmed" and the payment is recorded anyway.
 *
 * Written down here so nobody later "fixes" this to match the mockup.
 */

const shape = (over: Partial<PaymentShape> = {}): PaymentShape => ({
  method: "virement",
  currency: "DZD",
  partial: false,
  confirmed: new Set<string>(),
  ...over,
});

const find = (s: PaymentShape, key: string) => {
  const rule = rulesFor(s).find((r) => r.key === key);
  if (!rule) throw new Error(`no rule ${key}`);
  return rule;
};

describe("what the payment screen may say about the law", () => {
  it("shows all four rows whatever is selected, so a person can see the alternative", () => {
    expect(rulesFor(shape()).map((r) => r.key)).toEqual([
      "cashTimbre",
      "transferNoTimbre",
      "foreignCurrency",
      "partial",
    ]);
  });

  it("refuses to state the timbre rule while nobody has confirmed the threshold", () => {
    expect(find(shape({ method: "especes" }), "cashTimbre").state).toBe("check");
    expect(find(shape({ method: "virement" }), "transferNoTimbre").state).toBe("check");
  });

  it("does not say a rule does not apply when it does not know the rule", () => {
    // The tempting shortcut: "not cash, so no timbre". That is an assertion
    // about the law made by a system that has not been told the law.
    expect(find(shape({ method: "virement" }), "cashTimbre").state).not.toBe("doesNotApply");
  });

  it("states it plainly once somebody has confirmed it", () => {
    const confirmed = new Set([STAMP_DUTY_RULE]);
    expect(find(shape({ method: "especes", confirmed }), "cashTimbre").state).toBe("applies");
    expect(find(shape({ method: "virement", confirmed }), "cashTimbre").state).toBe("doesNotApply");
    expect(find(shape({ method: "virement", confirmed }), "transferNoTimbre").state).toBe(
      "applies",
    );
  });

  it("marks the row that matches what is being entered", () => {
    expect(find(shape({ method: "especes" }), "cashTimbre").active).toBe(true);
    expect(find(shape({ method: "especes" }), "transferNoTimbre").active).toBe(false);
    expect(find(shape({ method: "cheque" }), "cashTimbre").active).toBe(false);
  });

  it("keeps domiciliation as a question, because nobody has written it down", () => {
    const euros = find(shape({ currency: "EUR" }), "foreignCurrency");
    expect(euros.basis).toBe("unwritten");
    expect(euros.state).toBe("check");
    expect(euros.active).toBe(true);
    // No rule code, because inventing a confirmable rule out of a mockup is the
    // thing screen 69 exists to stop.
    expect(euros.ruleCode).toBeNull();
    expect(find(shape({ currency: "DZD" }), "foreignCurrency").active).toBe(false);
  });

  it("treats partial payment as structural, not as a permission somebody granted", () => {
    const partial = find(shape({ partial: true }), "partial");
    expect(partial.basis).toBe("structural");
    expect(partial.state).toBe("tracked");
    // Still tracked when the payment settles in full — the schema does not
    // change its mind about how it stores things.
    expect(find(shape({ partial: false }), "partial").state).toBe("tracked");
  });

  it("warns only about live, unsettled questions", () => {
    const cashInEuros = shape({ method: "especes", currency: "EUR", partial: true });
    expect(toCheck(rulesFor(cashInEuros)).map((r) => r.key)).toEqual([
      "cashTimbre",
      "foreignCurrency",
    ]);
  });

  it("says nothing at all when everything is settled and ordinary", () => {
    const settled = shape({ method: "virement", confirmed: new Set([STAMP_DUTY_RULE]) });
    // A warning strip that also carries reassurance is a warning strip people
    // stop reading.
    expect(toCheck(rulesFor(settled))).toEqual([]);
  });

  it("knows an instrument from a typo", () => {
    expect(isInstrument("virement")).toBe(true);
    expect(isInstrument("Virement")).toBe(false);
    expect(isInstrument("paypal")).toBe(false);
  });
});
