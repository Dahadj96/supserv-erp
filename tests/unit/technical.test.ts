import { describe, expect, it } from "vitest";
import {
  annexeVerdict,
  coverageOf,
  isGap,
  nextStepFor,
  stateOf,
  type TechnicalItem,
} from "@/domain/deal/technical";

/**
 * Screen 78 — the technical file.
 *
 * The distinction under test is the one the frame gives its own heading:
 * "'Not applicable' is a real answer — and it is not the same as 'we could not
 * find it'." In a completeness column both are "no file". Collapsing them
 * produces a screen that nags forever about a datasheet for bolts, or quietly
 * ships an annex missing the one for a 120W amplifier.
 */

let n = 0;
function item(over: Partial<TechnicalItem> = {}): TechnicalItem {
  n += 1;
  return {
    dealLineId: `l${n}`,
    itemId: `i${n}`,
    designation: `Item ${n}`,
    isGeneric: false,
    notApplicableReason: null,
    media: [],
    hasSupplier: true,
    ...over,
  };
}

const DATASHEET = { kind: "datasheet", provenance: "supplier" } as const;
const PHOTO = { kind: "photo", provenance: "our_photo" } as const;

describe("what state one item is in", () => {
  it("is complete when a datasheet exists", () => {
    expect(stateOf(item({ media: [DATASHEET] }))).toBe("complete");
  });

  it("is not applicable when somebody said so, with a reason", () => {
    expect(
      stateOf(item({ notApplicableReason: "aucun fabricant ne publie de fiche pour ce câble" })),
    ).toBe("notApplicable");
  });

  it("is not applicable when the catalogue already knows it is generic", () => {
    // Câble HP, boulonnerie, main-d'œuvre. `is_generic` lives on the item, so
    // it does not need saying again on every deal.
    expect(stateOf(item({ isGeneric: true }))).toBe("notApplicable");
  });

  it("does not un-answer a question somebody already answered", () => {
    // Marked not applicable AND holding a photo. The mark wins — re-deriving it
    // from what files exist teaches people that marking things is pointless.
    const marked = item({ notApplicableReason: "générique", media: [PHOTO] });
    expect(stateOf(marked)).toBe("notApplicable");
  });

  it("tells a missing datasheet from having nothing at all", () => {
    // A photo we took, no datasheet. The fix is chasing the supplier.
    expect(stateOf(item({ media: [PHOTO] }))).toBe("datasheetMissing");
    // Nothing, and nobody to ask. The fix is finding a supplier first.
    expect(stateOf(item({ media: [], hasSupplier: false }))).toBe("noSupplierYet");
  });
});

describe("a gap is not the same as an absence of files", () => {
  it("counts not applicable as complete, and nothing else as a gap", () => {
    expect(isGap("complete")).toBe(false);
    expect(isGap("notApplicable")).toBe(false);
    expect(isGap("datasheetMissing")).toBe(true);
    expect(isGap("nothingFound")).toBe(true);
    expect(isGap("noSupplierYet")).toBe(true);
  });

  it("sends you to a different job depending on the gap", () => {
    // A list that says "missing" against both sends somebody to write an email
    // to nobody.
    expect(nextStepFor("datasheetMissing")).toBe("askSupplier");
    expect(nextStepFor("noSupplierYet")).toBe("findSupplier");
    expect(nextStepFor("notApplicable")).toBe("none");
  });
});

/** The frame's file: 14 items, 9 complete, 3 missing, 2 not applicable. */
const FILE: TechnicalItem[] = [
  ...Array.from({ length: 9 }, () =>
    item({ media: [DATASHEET, { kind: "photo", provenance: "supplier" }] }),
  ),
  item({ isGeneric: true, designation: "Câble HP 2×1,5 mm²" }),
  item({ notApplicableReason: "prestation, pas un produit", designation: "Installation" }),
  item({ designation: "Support mural orientable", media: [PHOTO] }),
  item({ designation: "Boîtier de raccordement", media: [] }),
  item({ designation: 'Coffret 19" 6U', media: [], hasSupplier: false }),
];

describe("coverage", () => {
  const coverage = coverageOf(FILE);

  it("reproduces the frame's four counts", () => {
    expect(coverage).toMatchObject({
      items: 14,
      complete: 9,
      notApplicable: 2,
      missing: 3,
    });
  });

  it("says where the files it holds came from", () => {
    // Provenance is never dropped, because it decides what a file may be used
    // FOR — a picture the client sent is theirs and is locked to its deal.
    expect(coverage.fromSupplier).toBe(18);
    expect(coverage.ourPhotos).toBe(1);
  });

  it("counts a file the client sent apart from one we found", () => {
    const withClientImage = coverageOf([
      item({ media: [{ kind: "photo", provenance: "client" }] }),
      item({ media: [{ kind: "datasheet", provenance: "manufacturer" }] }),
    ]);
    expect(withClientImage.fromClient).toBe(1);
    expect(withClientImage.fromManufacturer).toBe(1);
  });
});

describe("whether the annexe can be built, and whether it stops the offer", () => {
  it("blocks submission when the client asked and there are gaps", () => {
    const verdict = annexeVerdict(FILE, "required");
    expect(verdict.gaps).toHaveLength(3);
    expect(verdict.blocksSubmission).toBe(true);
    expect(verdict.gaps.map((g) => g.state)).toEqual([
      "datasheetMissing",
      "nothingFound",
      "noSupplierYet",
    ]);
  });

  it("does not block when the client never asked", () => {
    // No requirement, no blocker. The same gaps are worth seeing on this screen
    // and worth nothing on the offer.
    expect(annexeVerdict(FILE, "kept_anyway").blocksSubmission).toBe(false);
    expect(annexeVerdict(FILE, "not_stated").blocksSubmission).toBe(false);
    // And they are still reported, because knowing is the point.
    expect(annexeVerdict(FILE, "not_stated").gaps).toHaveLength(3);
  });

  it("gives a page to every item with something to show, and no others", () => {
    // Printing "no datasheet exists for boulonnerie" on client letterhead is
    // padding, not an annex.
    const verdict = annexeVerdict(FILE, "required");
    expect(verdict.pages).toBe(10);
  });

  it("refuses to build an annex with nothing in it", () => {
    // A cover sheet followed by nothing is worse than admitting there is
    // nothing to send.
    const empty = annexeVerdict([item({ isGeneric: true }), item({ media: [] })], "not_stated");
    expect(empty.buildable).toBe(false);
    expect(empty.pages).toBe(0);
  });

  it("is buildable and unblocked when everything real is covered", () => {
    const clean = annexeVerdict(
      [item({ media: [DATASHEET] }), item({ isGeneric: true })],
      "required",
    );
    expect(clean.buildable).toBe(true);
    expect(clean.blocksSubmission).toBe(false);
    expect(clean.pages).toBe(1);
  });
});
