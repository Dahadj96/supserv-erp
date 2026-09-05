import { describe, expect, it } from "vitest";
import { asPenaltyBase, penaltyOf } from "@/domain/project/penalty";

/**
 * Pénalités de retard.
 *
 * The figure the client may apply against us when the work is late. Every
 * assertion here is about one thing: the system does not produce it until
 * somebody has read the CCAP, and when it does, it is arithmetic anybody can
 * check on paper.
 */
const MARCHE = {
  contractExcl: "4390000",
  contractIncl: "5224100",
  deadline: "2026-11-20",
  on: "2026-12-01",
  receivedOn: null,
};

const CLAUSE = { perMille: "1", capPct: "10", base: "excl" as const };

describe("a penalty nobody has read off the CCAP", () => {
  it("is not computed at all — no rate, no ceiling, no base", () => {
    expect(penaltyOf({ ...MARCHE, ...CLAUSE, perMille: null }).blocked).toBe("noClause");
    expect(penaltyOf({ ...MARCHE, ...CLAUSE, capPct: null }).blocked).toBe("noClause");
    expect(penaltyOf({ ...MARCHE, ...CLAUSE, base: null }).blocked).toBe("noClause");
    expect(penaltyOf({ ...MARCHE, ...CLAUSE, perMille: null }).amount).toBeNull();
  });

  it("says which fact is missing rather than showing zero", () => {
    expect(penaltyOf({ ...MARCHE, ...CLAUSE, deadline: null }).blocked).toBe("noDeadline");
    expect(penaltyOf({ ...MARCHE, ...CLAUSE, contractExcl: null }).blocked).toBe("noAmount");
    expect(penaltyOf({ ...MARCHE, ...CLAUSE, contractExcl: "0" }).blocked).toBe("noAmount");
  });

  it("takes only the two words the CCAP can say", () => {
    expect(asPenaltyBase("excl")).toBe("excl");
    expect(asPenaltyBase("incl")).toBe("incl");
    expect(asPenaltyBase("net")).toBeNull();
    expect(asPenaltyBase(null)).toBeNull();
  });
});

describe("a marché delivered on time", () => {
  it("carries a penalty of zero, and says so rather than saying nothing", () => {
    const view = penaltyOf({ ...MARCHE, ...CLAUSE, receivedOn: "2026-11-18" });
    expect(view.blocked).toBeNull();
    expect(view.daysLate).toBe(0);
    expect(view.amount).toBe("0.00");
    expect(view.stillRunning).toBe(false);
  });

  it("counts nothing when the réception is the deadline itself", () => {
    expect(penaltyOf({ ...MARCHE, ...CLAUSE, receivedOn: "2026-11-20" }).daysLate).toBe(0);
  });
});

describe("a marché delivered late", () => {
  it("counts the days to the réception and applies the rate to the HT", () => {
    const view = penaltyOf({ ...MARCHE, ...CLAUSE, receivedOn: "2026-12-05" });
    expect(view.daysLate).toBe(15);
    // 4 390 000 × 1‰ × 15
    expect(view.raw).toBe("65850.00");
    expect(view.amount).toBe("65850.00");
    expect(view.capped).toBe(false);
    expect(view.countedTo).toBe("2026-12-05");
    expect(view.stillRunning).toBe(false);
  });

  it("applies it to the TTC when that is what the CCAP says", () => {
    const view = penaltyOf({ ...MARCHE, ...CLAUSE, base: "incl", receivedOn: "2026-12-05" });
    expect(view.basis).toBe("5224100.00");
    // 5 224 100 × 1‰ × 15
    expect(view.amount).toBe("78361.50");
  });

  it("stops at the ceiling, and says it stopped", () => {
    // 1‰ a day reaches 10 % on the hundredth day.
    const view = penaltyOf({ ...MARCHE, ...CLAUSE, receivedOn: "2027-05-01" });
    expect(view.daysLate).toBe(162);
    expect(view.raw).toBe("711180.00");
    expect(view.cap).toBe("439000.00");
    expect(view.amount).toBe("439000.00");
    expect(view.capped).toBe(true);
  });
});

describe("a marché still running late", () => {
  it("counts to today and says the figure is not settled", () => {
    const view = penaltyOf({ ...MARCHE, ...CLAUSE, receivedOn: null, on: "2026-12-01" });
    expect(view.daysLate).toBe(11);
    expect(view.countedTo).toBe("2026-12-01");
    expect(view.amount).toBe("48290.00");
    expect(view.stillRunning).toBe(true);
  });

  it("is not still running while the work is still within its délai", () => {
    const view = penaltyOf({ ...MARCHE, ...CLAUSE, receivedOn: null, on: "2026-11-01" });
    expect(view.daysLate).toBe(0);
    expect(view.stillRunning).toBe(false);
  });

  it("counts from the délai AS AN AVENANT LEFT IT, not as the marché was signed", () => {
    // The same day, against a deadline an avenant de prolongation moved.
    const extended = penaltyOf({ ...MARCHE, ...CLAUSE, deadline: "2027-02-20" });
    expect(extended.daysLate).toBe(0);
    expect(extended.amount).toBe("0.00");
  });
});
