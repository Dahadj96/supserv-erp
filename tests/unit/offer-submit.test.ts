import { describe, expect, it } from "vitest";
import { canSubmit, countChecks, type SubmitFacts, submitChecks } from "@/domain/offer/submit";

/**
 * Screen 12 — "Before you submit".
 *
 * The distinction under test is the one screen 18 draws and this file inherits:
 * a RULE can block, a FACT never can. Getting that backwards produces a system
 * that refuses to let somebody submit an offer until they have proof of having
 * submitted it.
 */

const READY: SubmitFacts = {
  clientNif: "000116001234567",
  clientId: "party-1",
  lines: [
    { unitPrice: "44900", unitCost: "38400" },
    { unitPrice: "48200", unitCost: "41100" },
  ],
  submissionMethod: "deposit_sealed",
  submittedAt: null,
  proofRef: null,
  validDays: 90,
  requiredValidityDays: 90,
};

const facts = (over: Partial<SubmitFacts>): SubmitFacts => ({ ...READY, ...over });
const state = (f: SubmitFacts, key: string) => submitChecks(f).find((c) => c.key === key)?.state;

describe("rules block", () => {
  it("refuses without the client's NIF, and says where to fix it", () => {
    const check = submitChecks(facts({ clientNif: null })).find((c) => c.key === "clientNif");
    expect(check?.state).toBe("block");
    expect(check?.fixHref).toBe("/companies/party-1/edit");
    expect(canSubmit(submitChecks(facts({ clientNif: null })))).toBe(false);
  });

  it("refuses an unpriced line, and counts them", () => {
    const check = submitChecks(
      facts({
        lines: [
          { unitPrice: null, unitCost: "1" },
          { unitPrice: "0", unitCost: "1" },
        ],
      }),
    ).find((c) => c.key === "allLinesPriced");
    expect(check?.state).toBe("block");
    expect(check?.detail?.n).toBe(2);
  });

  it("refuses an offer with no submission method", () => {
    expect(state(facts({ submissionMethod: "unknown" }), "submissionMethod")).toBe("block");
  });

  it("refuses an offer that stands for less time than the client requires", () => {
    // The same comparison screen 67 makes against suppliers, pointed the other
    // way — and this one blocks, because it is our own promise to make.
    const check = submitChecks(facts({ validDays: 30 })).find(
      (c) => c.key === "validityCoversDeadline",
    );
    expect(check?.state).toBe("block");
    expect(check?.detail?.shortBy).toBe(60);
  });

  it("says nothing about validity when the client's requirement is unconfirmed", () => {
    // No requirement, no conflict — the rule that keeps the red boxes worth
    // reading.
    expect(
      state(facts({ requiredValidityDays: null, validDays: 30 }), "validityCoversDeadline"),
    ).toBeUndefined();
  });
});

describe("facts never block", () => {
  it("treats a line with no cost as worth knowing, not worth refusing", () => {
    // The client never sees the cost column. What an uncosted line cannot do is
    // tell you truthfully what you are making.
    const f = facts({ lines: [{ unitPrice: "44900", unitCost: null }] });
    expect(state(f, "allLinesCosted")).toBe("warn");
    expect(canSubmit(submitChecks(f))).toBe(true);
  });

  it("leaves proof of submission as a note until the envelope is handed over", () => {
    expect(state(READY, "proofOfSubmission")).toBe("note");
    expect(canSubmit(submitChecks(READY))).toBe(true);
  });

  it("warns once it was submitted and nobody recorded the receipt", () => {
    const submitted = facts({ submittedAt: new Date() });
    expect(state(submitted, "proofOfSubmission")).toBe("warn");
    expect(canSubmit(submitChecks(submitted))).toBe(true);
  });

  it("passes once the receipt has a reference", () => {
    expect(
      state(facts({ submittedAt: new Date(), proofRef: "BR-4471" }), "proofOfSubmission"),
    ).toBe("pass");
  });
});

describe("the count on the card", () => {
  it("lets a clean offer through", () => {
    expect(countChecks(submitChecks(READY))).toEqual({ blockers: 0, warnings: 0 });
    expect(canSubmit(submitChecks(READY))).toBe(true);
  });

  it("counts blockers and warnings apart", () => {
    const messy = facts({
      clientNif: null,
      lines: [{ unitPrice: "1", unitCost: null }],
    });
    expect(countChecks(submitChecks(messy))).toEqual({ blockers: 1, warnings: 1 });
  });
});
