import { describe, expect, it } from "vitest";
import {
  attractsStampDuty,
  STAMP_DUTY_AUTHORITY,
  stampDutyFor,
  stampDutyOn,
} from "@/domain/money/stamp-duty";

/**
 * The barème of LF 2025, as `stamp-duty.ts` writes it down. The figures below
 * are worked by hand from the text in that file's header; if a finance act
 * changes the barème, the file changes, the authority line changes, and these
 * change with them.
 */
describe("the droit de timbre on a cash sum", () => {
  it("is nought up to and including 300 DA", () => {
    expect(stampDutyOn("0")).toBe("0.00");
    expect(stampDutyOn("300")).toBe("0.00");
    expect(stampDutyOn("299.99")).toBe("0.00");
  });

  it("is never less than 5 DA once it applies", () => {
    // 301 DA → 4 tranches × 1 DA = 4, lifted to the minimum.
    expect(stampDutyOn("301")).toBe("5.00");
    expect(stampDutyOn("400")).toBe("5.00");
    // 600 DA → 6 tranches × 1 DA = 6, above the minimum on its own.
    expect(stampDutyOn("600")).toBe("6.00");
  });

  it("counts a started tranche as a whole one", () => {
    // 1 001 DA is 10.01 tranches → 11.
    expect(stampDutyOn("1001")).toBe("11.00");
    expect(stampDutyOn("1000")).toBe("10.00");
  });

  it("applies the rate of the bracket the WHOLE sum falls in to every tranche", () => {
    // 30 000 → 300 tranches × 1 DA.
    expect(stampDutyOn("30000")).toBe("300.00");
    // 30 001 → 301 tranches × 1.50 DA, not 300 × 1 + 1 × 1.50.
    expect(stampDutyOn("30001")).toBe("451.50");
    // 100 000 → 1 000 tranches × 1.50.
    expect(stampDutyOn("100000")).toBe("1500.00");
    // 100 001 → 1 001 tranches × 2.
    expect(stampDutyOn("100001")).toBe("2002.00");
  });

  it("has no ceiling — the 2 500 DA cap on old invoices is gone", () => {
    // 250 000 → 2 500 tranches × 2 = 5 000, above the old cap.
    expect(stampDutyOn("250000")).toBe("5000.00");
    // 10 834 000 (the UCC invoice of June) → 108 340 × 2.
    expect(stampDutyOn("10834000")).toBe("216680.00");
  });

  it("is only ever due on cash", () => {
    expect(attractsStampDuty("especes")).toBe(true);
    for (const other of ["virement", "cheque", "traite", "compensation", null, undefined, ""]) {
      expect(attractsStampDuty(other)).toBe(false);
    }
  });

  it("names the authority it rests on", () => {
    expect(STAMP_DUTY_AUTHORITY).toMatch(/LF 2025/);
    expect(STAMP_DUTY_AUTHORITY).toMatch(/art\. 100/);
  });
});

describe("what a draft carries", () => {
  /**
   * Screen 69's rule. Until a person has confirmed `invoice.stampDutyThreshold`
   * the software does not put a figure on an invoice on its own authority —
   * it warns at issue instead. The moment it is confirmed, a cash invoice
   * carries the duty and a transfer invoice does not.
   */
  it("carries nothing while the rule is unconfirmed, whatever the settlement", () => {
    expect(stampDutyFor({ totalIncl: "250000", settlement: "especes", ruleConfirmed: false })).toBe(
      "0.00",
    );
  });

  it("carries the duty on a cash invoice once the rule is confirmed", () => {
    expect(stampDutyFor({ totalIncl: "250000", settlement: "especes", ruleConfirmed: true })).toBe(
      "5000.00",
    );
  });

  it("carries nothing on a transfer, confirmed or not", () => {
    expect(stampDutyFor({ totalIncl: "250000", settlement: "virement", ruleConfirmed: true })).toBe(
      "0.00",
    );
  });
});
