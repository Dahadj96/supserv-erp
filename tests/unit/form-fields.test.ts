import { describe, expect, it } from "vitest";
import { readFormFields } from "../../scripts/lib/form-fields.mjs";

/**
 * Every field a person can fill in goes somewhere.
 *
 * `audit-actions` asks whether an action checks who is calling. This asks a
 * different question about the same forms: does the value somebody typed
 * reach the function it was posted to? A field named `theirNumber` on the form
 * and read `their_number` in the action submits cleanly, redirects cleanly,
 * and drops what was typed — and nothing on the screen afterwards says so.
 *
 * The script is `pnpm audit:forms`; this holds the same check in the suite,
 * and pins the two things a static check can quietly stop doing: finding the
 * forms at all, and following the actions it claims to follow.
 */
const rows = readFormFields();

/**
 * The forms whose action arrives as a PROP, so no static reader can say where
 * the fields go. Named rather than counted: a new one appearing is a decision
 * somebody made, and this is where they notice they made it.
 */
const NOT_FOLLOWED = [
  "src/app/[locale]/(app)/companies/company-form.tsx",
  "src/app/[locale]/(app)/documents/[id]/edit/builder.tsx",
  "src/app/[locale]/(app)/payments/record-payment.tsx",
];

describe("what every form field does", () => {
  it("finds the forms at all — a parser that found none would pass everything", () => {
    const forms = new Set(rows.map((r) => `${r.file}:${r.action}`));
    expect(forms.size).toBeGreaterThan(50);
    expect(rows.length).toBeGreaterThan(200);
  });

  it("is read by the action it posts to", () => {
    const dropped = rows
      .filter((r) => r.read === false)
      .map((r) => `${r.file} :: ${r.action} — "${r.field}"`);
    expect(dropped, "a field somebody fills in and nobody reads").toEqual([]);
  });

  it("follows every form but the ones handed their action as a prop", () => {
    const unfollowed = [...new Set(rows.filter((r) => r.read === null).map((r) => r.file))];
    expect(unfollowed.sort()).toEqual([...NOT_FOLLOWED].sort());
  });

  it("reads the templated names too — `qty:<lineId>` is a field like any other", () => {
    const prefixes = rows.filter((r) => r.kind === "prefix");
    expect(prefixes.length).toBeGreaterThan(0);
    expect(prefixes.every((r) => r.read !== false)).toBe(true);
  });
});
