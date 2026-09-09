import { describe, expect, it } from "vitest";
import {
  addDays,
  type Consequence,
  daysUntil,
  EXPIRY_KINDS,
  EXPIRY_STATES,
  expiryState,
} from "@/domain/control/expiring";
import { EXPIRING_WITHIN_DAYS } from "@/domain/tender/dossier";

/**
 * Screen 27b — everything that expires.
 *
 * The verdict is pure so the one case the tender module exists for can be
 * proved without a database: a paper valid today, expired on the morning of the
 * deposit. `tests/unit/tender-dossier.test.ts` pins it for one folder; this
 * pins that the company-wide view reaches the same answer and never a softer
 * one.
 *
 * The bias under test is one-directional, the same as the backup screen's: this
 * must never report a state BETTER than the truth. Amber on something safe
 * costs somebody a look; green on a paper that expires four days before a
 * deposit costs the bid.
 */

const NOW = new Date("2026-09-09T09:00:00Z");

function breaksAt(opts: { beforeDeposit: boolean }): Consequence[] {
  return [{ href: "/tenders/x", label: "AO-2026-014 · Adrar centre", ...opts }];
}

describe("how many days are left", () => {
  it("counts whole calendar days, not elapsed hours", () => {
    // Nine in the morning against a date at midnight must not read as "zero
    // days left" on the day before.
    expect(daysUntil("2026-09-09", NOW)).toBe(0);
    expect(daysUntil("2026-09-10", NOW)).toBe(1);
    expect(daysUntil("2026-09-08", NOW)).toBe(-1);
  });

  it("adds a validity to an issue date without leaving the yyyy-mm-dd shape", () => {
    // An offer issued on the last day of August, valid thirty days.
    expect(addDays("2026-08-31", 30)).toBe("2026-09-30");
    expect(addDays("2026-12-20", 30)).toBe("2027-01-19");
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
  });
});

describe("what state a date is in", () => {
  it("calls a date in the past expired, whatever depends on it", () => {
    expect(expiryState(-1, [])).toBe("expired");
    expect(expiryState(-1, breaksAt({ beforeDeposit: true }))).toBe("expired");
  });

  it("puts expiring-before-a-deposit ABOVE the thirty-day warning", () => {
    // THE ONE THAT MATTERS. Ninety days of life left is comfortable by every
    // other reading, and useless for a tender deposited in a hundred.
    expect(expiryState(90, breaksAt({ beforeDeposit: true }))).toBe("beforeDeposit");
    expect(expiryState(90, breaksAt({ beforeDeposit: false }))).toBe("later");
  });

  it("does not soften a piece inside the window because a deposit is later", () => {
    expect(expiryState(3, breaksAt({ beforeDeposit: true }))).toBe("beforeDeposit");
    expect(expiryState(3, breaksAt({ beforeDeposit: false }))).toBe("soon");
  });

  it("warns from the same thirty days the tender folder warns from", () => {
    // One number, imported rather than copied: two warning windows drifting
    // apart would make screen 08 and this screen disagree about one paper.
    expect(expiryState(EXPIRING_WITHIN_DAYS, [])).toBe("soon");
    expect(expiryState(EXPIRING_WITHIN_DAYS + 1, [])).toBe("later");
    expect(expiryState(0, [])).toBe("soon");
  });

  it("never invents a state the screen has no label for", () => {
    const cases = [-400, -1, 0, 1, 30, 31, 900];
    for (const days of cases) {
      for (const breaks of [[], breaksAt({ beforeDeposit: true })]) {
        expect(EXPIRY_STATES).toContain(expiryState(days, breaks));
      }
    }
  });
});

describe("the four things this page claims to cover", () => {
  it("names all four, so a fifth cannot be added without a label for it", () => {
    // Every kind needs `expiring.kind.*` and `expiring.renew.*` in both message
    // files; this list is what the screen builds those keys from.
    expect([...EXPIRY_KINDS]).toEqual(["credential", "caution", "certification", "offer"]);
  });
});
