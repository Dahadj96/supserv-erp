import { describe, expect, it } from "vitest";
import {
  countDiffering,
  type DesignationLine,
  normaliseWording,
  resolveDesignation,
  sameWording,
} from "@/domain/designation";

/**
 * Screen 75. "Whatever prints here is what the client accepts."
 *
 * The eight lines below are the eight lines drawn on the screen, so the
 * verdicts this file asserts are the badges a person will actually see.
 */
const line = (
  clientWording: string,
  supplierWording: string | null,
  extra: Partial<DesignationLine> = {},
): DesignationLine => ({ clientWording, supplierWording, ...extra });

describe("which name goes on the offer", () => {
  it("treats accents, case and × as noise, not as a difference", () => {
    expect(normaliseWording("Câble HP 2×1,5 mm²")).toBe("cable hp 2x1 5 mm2");
    expect(sameWording("Câble HP 2×1,5 mm²", "CABLE HP 2x1,5 mm2")).toBe(true);
    // A screen that flagged these would teach people to ignore the flag.
    expect(
      resolveDesignation(line("Câble HP 2×1,5 mm²", "Câble HP 2x1,5 mm2 CU souple")).verdict,
    ).not.toBe("same");
  });

  it("says Same when the two wordings agree", () => {
    const d = resolveDesignation(line("Câble HP 2×1,5 mm²", "Câble HP 2×1,5 mm²"));
    expect(d.verdict).toBe("same");
    expect(d.prints).toBe("Câble HP 2×1,5 mm²");
  });

  it("combines by default — the client's wording, the supplier's reference added", () => {
    const d = resolveDesignation(
      line("Amplificateur 120W 4 zones", "Ampli mélangeur 120W 4Z + BT", {
        supplierReference: "Bluetooth inclus",
      }),
    );
    expect(d.rule).toBe("combined");
    expect(d.prints).toBe("Amplificateur 120W 4 zones (Bluetooth inclus)");
    // The person has already been told what the supplier calls it, so there is
    // nothing left for them to check.
    expect(d.verdict).toBe("ruleApplied");
  });

  it("flags a real difference when the rule hides one side", () => {
    const clientOnly = resolveDesignation(
      line("Support mural orientable", "Support mural inclinable 30°", { rule: "client" }),
    );
    expect(clientOnly.prints).toBe("Support mural orientable");
    expect(clientOnly.verdict, "the supplier's wording is not printed anywhere").toBe("differs");

    const supplierOnly = resolveDesignation(
      line("Support mural orientable", "Support mural inclinable 30°", { rule: "supplier" }),
    );
    expect(supplierOnly.prints).toBe("Support mural inclinable 30°");
    expect(supplierOnly.verdict).toBe("differs");
  });

  it("says Ours when there is no supplier, because there is nothing to reconcile", () => {
    const d = resolveDesignation(line("Installation et mise en service", null));
    expect(d.verdict).toBe("ours");
    expect(d.prints).toBe("Installation et mise en service");
  });

  it("prints our own wording when somebody has edited it", () => {
    const d = resolveDesignation(
      line("Micro col de cygne", "Micro col de cygne 45 cm à base", {
        rule: "ours",
        ourWording: "Micro col de cygne 45 cm",
      }),
    );
    expect(d.prints).toBe("Micro col de cygne 45 cm");
  });

  it("never repeats the client's own words in brackets", () => {
    const d = resolveDesignation(
      line("Mégaphone portatif 25W", "Mégaphone portatif 25 W", {
        supplierReference: "Mégaphone portatif 25W",
      }),
    );
    expect(d.prints).toBe("Mégaphone portatif 25W");
  });

  it("counts only the lines a person has to look at", () => {
    const lines = [
      line("Mégaphone portatif 25W", "Mégaphone TOA ER-2230W 25W", {
        supplierReference: "TOA ER-2230W",
      }),
      line("Haut-parleur mural 10W", "HP mural 10W 100V ABS blanc", {
        supplierReference: "HP mural 10W 100V",
      }),
      line("Amplificateur 120W 4 zones", "Ampli mélangeur 120W 4Z + BT", { rule: "client" }),
      line("Câble HP 2×1,5 mm²", "Câble HP 2×1,5 mm²"),
      line("Installation et mise en service", null),
      line("Support mural orientable", "Support mural inclinable 30°", { rule: "supplier" }),
    ];
    // Two are flagged. The combined ones resolved, the identical one agrees,
    // and the one with no supplier is ours.
    expect(countDiffering(lines)).toBe(2);
  });
});
