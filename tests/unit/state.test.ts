import { describe, expect, it } from "vitest";
import { canTransition, dealOutcome, isOverdue } from "@/domain/state";

describe("state", () => {
  it("treats overdue as computed, never stored", () => {
    const past = new Date("2026-01-01");
    expect(isOverdue(past, "5640000.00", new Date("2026-08-19"))).toBe(true);
    expect(isOverdue(past, "0.00", new Date("2026-08-19"))).toBe(false);
  });

  it("refuses to edit a paid invoice back to draft", () => {
    expect(canTransition("paid", "draft" as never)).toBe(false);
    expect(canTransition("issued", "part_paid")).toBe(true);
  });

  it("reads won from the offer, never storing it on the deal", () => {
    expect(dealOutcome(["sent", "accepted"])).toBe("won");
    expect(dealOutcome(["rejected", "expired"])).toBe("lost");
    expect(dealOutcome(["sent"])).toBe("open");
  });
});
