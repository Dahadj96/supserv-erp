import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { partyInput } from "@/domain/party";

/**
 * The company form says why it refused.
 *
 * It could not. `createCompany` called `partyInput.parse` with nothing around
 * it, so every refusal threw out of the server action and rendered the error
 * boundary — which on a production build says nothing a person can act on. The
 * commonest refusal was the emptiest one: a role is required, and no role was
 * ticked by default, so the first company anybody tried to record failed on
 * the field furthest from what they came to type. It was reported two screens
 * downstream as "I cannot create an enquiry".
 *
 * This is `setup-errors.test.ts` applied to the other form that stands between
 * a new install and doing any work at all. The schema carries MESSAGE KEYS, the
 * action puts one in `?error=`, and the form renders
 * `t("company.error." + key)` — so a rule added with Zod's own English default
 * would render `[company.error.Invalid input]` on the screen of somebody
 * typing their client's registration number.
 */
const root = resolve(import.meta.dirname, "../..");
const load = (locale: string) =>
  JSON.parse(readFileSync(`${root}/src/i18n/messages/${locale}.json`, "utf8"));

const en = load("en");
const fr = load("fr");

/**
 * Shaped the way the ACTION shapes it: `parseForm` reads every field with
 * `String(formData.get(...) ?? "")`, so the schema never sees `undefined` and
 * the keys stay ours. Testing with `{}` would prove something the form cannot
 * do.
 */
const asForm = (over: Record<string, unknown> = {}) => ({
  legalName: "SARL TOUATGAZ",
  tradeName: "",
  roles: ["client"],
  nif: "",
  nis: "",
  rc: "",
  ai: "",
  email: "",
  phone: "",
  address: "",
  wilaya: "",
  docLocale: "fr",
  emailLocale: "fr",
  currency: "DZD",
  paymentTerms: "",
  ...over,
});

function messagesFor(over: Record<string, unknown>): string[] {
  const result = partyInput.safeParse(asForm(over));
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.message);
}

describe("what the company form refuses, and what it says", () => {
  it("accepts a company with a name and a role and nothing else", () => {
    // The whole design rests on this: a company arrives from an email long
    // before anybody has its NIF. If this ever starts failing, the ERP has
    // grown a requirement the décret does not make.
    expect(partyInput.safeParse(asForm()).success).toBe(true);
  });

  it("refuses no role at all — the state this form starts in", () => {
    expect(messagesFor({ roles: [] })).toContain("roleRequired");
  });

  it("refuses a name too short to be one", () => {
    expect(messagesFor({ legalName: "" })).toContain("legalNameTooShort");
    expect(messagesFor({ legalName: "A" })).toContain("legalNameTooShort");
  });

  it("refuses a NIF that is not fifteen digits, and accepts none at all", () => {
    expect(messagesFor({ nif: "0001160012" })).toContain("nifFifteenDigits");
    expect(partyInput.safeParse(asForm({ nif: "000116001234567" })).success).toBe(true);
    expect(partyInput.safeParse(asForm({ nif: "" })).success).toBe(true);
  });

  it("refuses an address that is not one", () => {
    expect(messagesFor({ email: "not-an-email" })).toContain("emailInvalid");
  });

  it("says every one of them in both languages", () => {
    const produced = new Set([
      ...messagesFor({ roles: [] }),
      ...messagesFor({ legalName: "" }),
      ...messagesFor({ nif: "123" }),
      ...messagesFor({ email: "nope" }),
    ]);
    expect(produced.size, "the inputs above stopped being wrong").toBeGreaterThan(0);

    for (const key of produced) {
      expect(en.company?.error?.[key], `company.error.${key} (English)`).toBeTypeOf("string");
      expect(fr.company?.error?.[key], `company.error.${key} (French)`).toBeTypeOf("string");
    }
  });

  it("has something to say when the refusal was not one of those", () => {
    // The action falls back to this, and so does the form when a key does not
    // resolve. It is the least likely path and the worst to land on silently.
    expect(en.company?.error?.invalid).toBeTypeOf("string");
    expect(fr.company?.error?.invalid).toBeTypeOf("string");
  });
});
