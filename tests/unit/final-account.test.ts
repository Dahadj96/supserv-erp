import { describe, expect, it } from "vitest";
import { type FinalAccountSituation, finalAccountOf } from "@/domain/project/final-account";

/**
 * The décompte final.
 *
 * Three situations on a marché of 4 730 000 HT, 19 % throughout, 5 % retenue
 * de garantie, a 300 000 advance recovered across the first two. Every figure
 * below can be checked with a calculator against the three situations, which
 * is the whole point of the page.
 */
function situation(
  sequence: number,
  excl: number,
  opts: Partial<FinalAccountSituation> = {},
): FinalAccountSituation {
  const vat = excl * 0.19;
  const incl = excl + vat;
  return {
    sequence,
    number: `SIT-2026-0${sequence}`,
    issuedOn: "2026-07-02",
    approvedOn: "2026-07-20",
    status: "issued",
    excl: excl.toFixed(2),
    vat: vat.toFixed(2),
    incl: incl.toFixed(2),
    retention: (excl * 0.05).toFixed(2),
    advanceDeducted: "0",
    paid: "0",
    ...opts,
  };
}

const THREE = [
  situation(1, 1560000, { advanceDeducted: "200000", paid: "1700000" }),
  situation(2, 940000, { advanceDeducted: "100000", paid: "900000" }),
  situation(3, 264000),
];

const CLOSED = {
  situations: THREE,
  pvProvisoireOn: "2026-11-28",
  penalty: null,
  retentionReleased: "0",
};

describe("a marché that cannot be closed yet", () => {
  it("refuses to draw one at all with no situations", () => {
    expect(finalAccountOf({ ...CLOSED, situations: [] }).blocked).toBe("noSituations");
  });

  it("refuses while a situation is still a draft", () => {
    const withDraft = [...THREE, situation(4, 50000, { status: "draft", number: null })];
    expect(finalAccountOf({ ...CLOSED, situations: withDraft }).blocked).toBe("situationUnissued");
  });

  it("refuses while a situation is issued and unsigned", () => {
    const unsigned = [...THREE, situation(4, 50000, { approvedOn: null })];
    expect(finalAccountOf({ ...CLOSED, situations: unsigned }).blocked).toBe("situationUnapproved");
  });

  it("refuses before the work has been accepted", () => {
    expect(finalAccountOf({ ...CLOSED, pvProvisoireOn: null }).blocked).toBe("noReception");
  });
});

describe("the décompte final", () => {
  const account = finalAccountOf(CLOSED);

  it("adds up the situations and nothing else", () => {
    expect(account.blocked).toBeNull();
    // 1 560 000 + 940 000 + 264 000
    expect(account.worksExcl).toBe("2764000.00");
    expect(account.worksVat).toBe("525160.00");
    expect(account.worksIncl).toBe("3289160.00");
  });

  it("counts the advance recovered and the retention withheld separately", () => {
    expect(account.advanceRecovered).toBe("300000.00");
    // 5 % of the HT of each
    expect(account.retentionHeld).toBe("138200.00");
    // 3 289 160 − 300 000 − 138 200
    expect(account.netCertified).toBe("2850960.00");
  });

  it("leaves the balance the client still owes", () => {
    expect(account.paid).toBe("2600000.00");
    expect(account.balance).toBe("250960.00");
  });

  it("shows the retention as money to come back, not money lost", () => {
    expect(account.retentionToRelease).toBe("138200.00");
    expect(finalAccountOf({ ...CLOSED, retentionReleased: "138200" }).retentionToRelease).toBe(
      "0.00",
    );
  });

  it("takes the penalty off the balance, and only when it is known", () => {
    expect(account.penalty).toBe("0.00");
    const late = finalAccountOf({ ...CLOSED, penalty: "52030" });
    expect(late.penalty).toBe("52030.00");
    expect(late.balance).toBe("198930.00");
    // The works themselves are untouched: a penalty is not a discount.
    expect(late.worksExcl).toBe(account.worksExcl);
  });

  it("counts the situations in order, whatever order they arrive in", () => {
    const shuffled = finalAccountOf({
      ...CLOSED,
      situations: [THREE[2], THREE[0], THREE[1]] as FinalAccountSituation[],
    });
    expect(shuffled.counted.map((s) => s.sequence)).toEqual([1, 2, 3]);
    expect(shuffled.balance).toBe(account.balance);
  });
});
