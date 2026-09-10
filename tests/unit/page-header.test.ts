import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * P1 — the actions slot is required, and this is the part TypeScript cannot
 * check on its own.
 *
 * The type union already refuses `<PageHeader>` without `actions`, and refuses
 * `actions={null}` without `noActionReason`. What it cannot see is a screen
 * that renders the component and ALSO keeps the `h1` it was supposed to
 * replace — two titles, one of them the wrong size — and it cannot see a
 * `noActionReason` written as a literal string instead of a message key, which
 * is a sentence in one language on a screen two people read in two.
 *
 * Twenty screens have a title and no action today because nothing ever asked
 * their author to fill the slot. This is the thing that asks.
 */
const root = resolve(import.meta.dirname, "../..");

const pages = globSync(`${root}/src/app/**/*.tsx`).map((path) => ({
  path: path.slice(root.length + 1).replaceAll("\\", "/"),
  src: readFileSync(path, "utf8"),
}));

const usesComponent = pages.filter((page) => page.src.includes("<PageHeader"));

describe("PageHeader", () => {
  it("is used by the screens P1 converted", () => {
    expect(usesComponent.length).toBeGreaterThanOrEqual(9);
  });

  it("never sits on a screen that also hand-writes an h1", () => {
    // The bordered strip itself is not the signal — a facet row wears the same
    // `border-b … bg-surface`. The title is: a converted screen has exactly one
    // and the component owns it.
    const both = usesComponent.filter((page) => page.src.includes("<h1")).map((page) => page.path);
    expect(both, "renders PageHeader and still hand-writes a title").toEqual([]);
  });

  it("is never given an actions slot it did not have to fill", () => {
    const missing = usesComponent.filter((page) => !/\n\s*actions=/.test(page.src));
    expect(
      missing.map((p) => p.path),
      "no actions prop",
    ).toEqual([]);
  });

  it("says why, in both languages, wherever it has no action", () => {
    for (const page of usesComponent) {
      if (!page.src.includes("actions={null}")) continue;
      const reason = page.src.match(/noActionReason=\{t\("([^"]+)"\)\}/);
      expect(reason, `${page.path}: actions={null} with no translated reason`).not.toBeNull();
    }
  });

  it("keeps the page title on the token rather than a hardcoded size", () => {
    const component = readFileSync(`${root}/src/components/layout/page-header.tsx`, "utf8");
    expect(component).toContain("text-title");
    expect(component).not.toMatch(/text-\[\d/);
  });

  it("leaves no page title anywhere on the hardcoded 19px it replaced", () => {
    const left = pages.filter((page) => page.src.includes("text-[19px]")).map((p) => p.path);
    expect(left, "P2 moved every page title onto --text-title").toEqual([]);
  });
});
