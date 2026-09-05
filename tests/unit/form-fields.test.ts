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
 * THE THREE FORMS THAT ARE HANDED THEIR ACTION AS A PROP, and the actions the
 * screens rendering them actually pass.
 *
 * These were unfollowed for a fortnight — the reader saw `<form action={action}>`,
 * could not say what `action` was, and reported "not followed", which reads as
 * green. They were the company form, the document builder and the payment
 * recorder: forty-three fields, on the three forms in this ERP where a
 * silently dropped value costs the most. The reader follows the prop to
 * whoever renders the component now, and both of the company form's two
 * callers are checked, because `createCompany` reading a field that
 * `updateCompany` drops is exactly the bug.
 */
const BY_PROP: Record<string, string[]> = {
  "src/app/[locale]/(app)/companies/company-form.tsx": ["createCompany", "updateCompany"],
  "src/app/[locale]/(app)/documents/[id]/edit/builder.tsx": ["saveDraftAction"],
  "src/app/[locale]/(app)/payments/record-payment.tsx": ["recordPaymentAction"],
};

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

  it("follows every form there is — nothing is reported green by being unreadable", () => {
    const unfollowed = [...new Set(rows.filter((r) => r.read === null).map((r) => r.file))];
    expect(unfollowed, "a form whose action nobody can name").toEqual([]);
  });

  it("follows a form's action through the prop it arrives on, to every screen that passes one", () => {
    for (const [file, expected] of Object.entries(BY_PROP)) {
      const actions = [...new Set(rows.filter((r) => r.file === file).map((r) => r.action))];
      expect(actions.sort(), file).toEqual([...expected].sort());
    }
  });

  it("reads the templated names too — `qty:<lineId>` is a field like any other", () => {
    const prefixes = rows.filter((r) => r.kind === "prefix");
    expect(prefixes.length).toBeGreaterThan(0);
    expect(prefixes.every((r) => r.read !== false)).toBe(true);
  });
});
