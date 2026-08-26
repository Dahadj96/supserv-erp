/**
 * Screen 78 — the technical file, and whether the annexe technique can be built.
 *
 * The whole screen turns on one distinction, and the frame states it as a
 * heading: **"'Not applicable' is a real answer — and it is not the same as
 * 'we could not find it'."**
 *
 *   NOT APPLICABLE — câble HP, boulonnerie, main-d'œuvre. Generic goods and
 *   services that no manufacturer publishes a datasheet for. Marked once, with
 *   a reason, and it COUNTS AS COMPLETE.
 *
 *   NOTHING FOUND — a real product that should have a datasheet and we do not
 *   have it. Counts as a gap, and blocks the annex if the client asked for one.
 *
 * In a completeness column those two look identical: both are "no file". They
 * mean opposite things, and collapsing them produces a screen that either nags
 * forever about a datasheet for bolts, or quietly ships an annex missing the
 * datasheet for a 120W amplifier. It is the same mistake as counting a bounced
 * address as a slow supplier (screen 67).
 *
 * The second rule: A GAP ONLY BLOCKS WHEN THE CLIENT ASKED. "when required, a
 * missing datasheet blocks submission" — and when they did not ask, the same
 * gap is worth knowing and worth nothing else. No requirement, no blocker; the
 * same principle the sourcing conflicts run on.
 */

/** The deal-level answer to "Did the client ask for them?" */
export const REQUIREMENTS = ["required", "kept_anyway", "not_stated"] as const;
export type Requirement = (typeof REQUIREMENTS)[number];

export function isRequirement(value: string | undefined): value is Requirement {
  return REQUIREMENTS.includes((value ?? "") as Requirement);
}

/**
 * Where a file came from. Provenance is never dropped, because it decides what
 * a file may be USED for — a picture the client sent is theirs and is locked to
 * the deal it arrived on (`item_media.dealId`), while a manufacturer's
 * datasheet serves every future enquiry.
 */
export const PROVENANCES = ["supplier", "manufacturer", "our_photo", "client"] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const MEDIA_KINDS = ["datasheet", "photo", "certificate", "diagram", "manual"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** One row of the item-by-item table. */
export type TechnicalItem = {
  dealLineId: string;
  itemId: string | null;
  designation: string;
  /** No manufacturer publishes a datasheet for this. Set on the ITEM. */
  isGeneric: boolean;
  /** Marked not applicable on THIS deal, with a reason a person typed. */
  notApplicableReason: string | null;
  media: { kind: MediaKind; provenance: Provenance }[];
  /** Whether any supplier has been found for it at all. */
  hasSupplier: boolean;
};

export const ITEM_STATES = [
  "complete",
  "notApplicable",
  "datasheetMissing",
  "nothingFound",
  "noSupplierYet",
] as const;
export type ItemState = (typeof ITEM_STATES)[number];

/**
 * What state one item is in.
 *
 * Order matters. "Not applicable" is checked FIRST and wins over everything:
 * once a person has said "nobody publishes a datasheet for boulonnerie, here is
 * why", the system stops asking. Re-deriving it from what files exist would
 * un-answer a question somebody already answered, which is the surest way to
 * teach people that marking things is pointless.
 */
export function stateOf(item: TechnicalItem): ItemState {
  // Somebody said so, with a reason. It counts as complete.
  if (item.notApplicableReason) return "notApplicable";

  // `is_generic` on the item — câble, main-d'œuvre. The catalogue already knows
  // no datasheet exists, so it does not need saying again per deal.
  if (item.isGeneric) return "notApplicable";

  const hasDatasheet = item.media.some((m) => m.kind === "datasheet");
  if (hasDatasheet) return "complete";

  // Nothing at all, and nobody to ask. Different from "we have a supplier and
  // no datasheet" — the fix is finding a supplier, not chasing a file.
  if (item.media.length === 0 && !item.hasSupplier) return "noSupplierYet";

  // We have SOMETHING — a photo we took — but not the datasheet.
  if (item.media.length > 0) return "datasheetMissing";

  // A real product, a supplier exists, and we hold nothing.
  return "nothingFound";
}

/** The states that leave a hole in the annexe. `notApplicable` is not one. */
export function isGap(state: ItemState): boolean {
  return state !== "complete" && state !== "notApplicable";
}

export type Coverage = {
  items: number;
  complete: number;
  notApplicable: number;
  missing: number;
  /** Where the files we DO hold came from. */
  fromSupplier: number;
  fromManufacturer: number;
  ourPhotos: number;
  fromClient: number;
};

export function coverageOf(items: TechnicalItem[]): Coverage {
  const coverage: Coverage = {
    items: items.length,
    complete: 0,
    notApplicable: 0,
    missing: 0,
    fromSupplier: 0,
    fromManufacturer: 0,
    ourPhotos: 0,
    fromClient: 0,
  };

  for (const item of items) {
    const state = stateOf(item);
    if (state === "complete") coverage.complete += 1;
    else if (state === "notApplicable") coverage.notApplicable += 1;
    else coverage.missing += 1;

    for (const media of item.media) {
      if (media.provenance === "supplier") coverage.fromSupplier += 1;
      else if (media.provenance === "manufacturer") coverage.fromManufacturer += 1;
      else if (media.provenance === "our_photo") coverage.ourPhotos += 1;
      else if (media.provenance === "client") coverage.fromClient += 1;
    }
  }

  return coverage;
}

export type AnnexeVerdict = {
  /** Can the annexe be built at all? A document with no pages is not a document. */
  buildable: boolean;
  /** Does the gap stop the OFFER going out? Only when the client asked. */
  blocksSubmission: boolean;
  /** One page per item that has something to show. */
  pages: number;
  /** The items with a hole in them, in table order. */
  gaps: { dealLineId: string; designation: string; state: ItemState }[];
};

/**
 * Whether the annexe technique can be built, and whether its holes stop the
 * offer.
 *
 * Two different questions, deliberately answered separately:
 *
 *   `buildable` — is there anything to put in it. An annex with no pages is not
 *   a document, and generating a cover sheet followed by nothing is worse than
 *   admitting there is nothing to send.
 *
 *   `blocksSubmission` — does a gap stop the bid. ONLY when the client asked for
 *   fiches techniques. If they did not ask, an incomplete technical file is
 *   worth seeing on this screen and worth nothing on the offer. The frame says
 *   it in the caption: "when required, a missing datasheet blocks submission."
 */
export function annexeVerdict(items: TechnicalItem[], requirement: Requirement): AnnexeVerdict {
  const gaps: AnnexeVerdict["gaps"] = [];
  let pages = 0;

  for (const item of items) {
    const state = stateOf(item);
    if (isGap(state)) {
      gaps.push({ dealLineId: item.dealLineId, designation: item.designation, state });
    }
    // A page needs something on it. `notApplicable` earns no page — printing
    // "no datasheet exists for boulonnerie" on client letterhead is padding.
    if (item.media.length > 0) pages += 1;
  }

  return {
    buildable: pages > 0,
    blocksSubmission: requirement === "required" && gaps.length > 0,
    pages,
    gaps,
  };
}

/**
 * Screen 78's "The three that are missing" — what to do about each gap.
 *
 * The action differs by state and that is the point of having states rather
 * than a boolean. Chasing a supplier for a datasheet is a different job from
 * finding a supplier at all, and a list that says "missing" against both sends
 * somebody to write an email to nobody.
 */
export function nextStepFor(state: ItemState): "askSupplier" | "findSupplier" | "none" {
  if (state === "datasheetMissing" || state === "nothingFound") return "askSupplier";
  if (state === "noSupplierYet") return "findSupplier";
  return "none";
}
