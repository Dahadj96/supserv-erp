import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { bankInput, identityInput, seriesInput, vatInput } from "@/domain/company";

/**
 * Day one is four forms, and it is the one flow in this system that a person
 * meets before anything else works — nothing can be issued until it is done.
 *
 * The four schemas in `src/domain/company.ts` do not carry sentences. Every
 * `.min()` and `.regex()` carries a MESSAGE KEY — `nifFifteenDigits`,
 * `ribTwentyDigits` — the action puts that key straight into `?error=`, and the
 * page renders `t("setup.error." + key)`. That is a neat arrangement and it has
 * one failure mode: somebody adds a rule, Zod supplies its own English default
 * ("Invalid", "Required", "String must contain at least 1 character(s)"), and
 * the key does not resolve.
 *
 * It would not throw. `messageFallback` renders `[setup.error.Required]` — on
 * the screen somebody is using to type in their company's registration number,
 * the first time they mistype it. So the schemas are asked here what they will
 * actually say.
 */
const root = resolve(import.meta.dirname, "../..");
const load = (locale: string) =>
  JSON.parse(readFileSync(`${root}/src/i18n/messages/${locale}.json`, "utf8"));

const en = load("en");
const fr = load("fr");

/** Every message these four schemas can produce, for input that is all wrong. */
function messagesOf(schema: z.ZodType, input: unknown): string[] {
  const result = schema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.message);
}

const SCHEMAS: { name: string; schema: z.ZodType; bad: unknown[] }[] = [
  {
    name: "identityInput",
    schema: identityInput,
    bad: [
      {},
      { legalName: "", rc: "", nif: "", nis: "", ai: "", address: "" },
      // Every field present and every one of them wrong in its own way.
      {
        legalName: "A",
        rc: "",
        nif: "123",
        nis: "",
        ai: "",
        address: "x",
        email: "not-an-email",
        capital: "six millions",
      },
    ],
  },
  {
    name: "vatInput",
    schema: vatInput,
    bad: [{}, { rate: "abc", kind: "", startsOn: "" }, { rate: "-1", kind: "nonsense" }],
  },
  {
    name: "bankInput",
    schema: bankInput,
    bad: [{}, { bankName: "", rib: "123" }, { bankName: "BNA", rib: "not twenty digits" }],
  },
  {
    name: "seriesInput",
    schema: seriesInput,
    bad: [
      {},
      { kind: "", pattern: "", reset: "yearly" },
      // A pattern with neither a year nor a counter in it.
      { kind: "invoice", pattern: "FACTURE", reset: "yearly" },
      { kind: "invoice", pattern: "FAC-{YYYY}", reset: "yearly" },
      // A kind the catalogue does not have — "offer" was on the day-one screen
      // for a fortnight and this ERP calls a devis `quotation`.
      { kind: "offer", pattern: "OFF/{YYYY}/{####}", reset: "yearly" },
      // A kind that carries the counterparty's number, so it has no series.
      { kind: "amendment", pattern: "AV/{YYYY}/{####}", reset: "yearly" },
    ],
  },
];

describe("the capital is read the way it is written on the letterhead", () => {
  /**
   * The column is numeric. The value on every SUPSERV proforma reads
   * "Capital : 6 000 000,00 DA", and before this transform existed the form
   * accepted those words and Postgres refused them — a 500 on the first form
   * of day one, found by rehearsing day one against the test database.
   */
  const base = {
    legalName: "SARL SUPSERV",
    rc: "01/00-0883062 B19",
    nif: "001901088306288",
    nis: "001901010000282",
    ai: "01011120488",
    address: "N°19, Cité 67 Logements, 01000 Adrar",
  };

  it.each([
    ["6 000 000,00 DA", "6000000.00"],
    ["6.000.000,00", "6000000.00"],
    ["6000000", "6000000"],
    ["1 500 000 DZD", "1500000"],
    ["", ""],
  ])("turns %j into %j", (written, stored) => {
    const parsed = identityInput.parse({ ...base, capital: written });
    expect(parsed.capital).toBe(stored);
  });

  it("refuses words with a key the screen can show", () => {
    const result = identityInput.safeParse({ ...base, capital: "six millions" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("capitalInvalid");
  });
});

describe("day one says something a person can read", () => {
  it.each(SCHEMAS)("$name only produces keys that resolve", ({ schema, bad }) => {
    const produced = new Set(bad.flatMap((input) => messagesOf(schema, input)));

    // If this is empty the test is proving nothing — the inputs above stopped
    // being wrong, probably because a rule was relaxed.
    expect(produced.size).toBeGreaterThan(0);

    for (const key of produced) {
      expect(en.setup?.error?.[key], `setup.error.${key} (English)`).toBeTypeOf("string");
      expect(fr.setup?.error?.[key], `setup.error.${key} (French)`).toBeTypeOf("string");
    }
  });

  /**
   * The actions fall back to `invalid` when an error is not a Zod one at all —
   * a unique-constraint violation, a dropped connection. That path is the least
   * likely and the worst to land on with no words.
   */
  it("has something to say when the failure was not a validation failure", () => {
    expect(en.setup?.error?.invalid).toBeTypeOf("string");
    expect(fr.setup?.error?.invalid).toBeTypeOf("string");
  });

  /**
   * The reverse: a key nobody can reach is a sentence somebody wrote and no
   * screen will ever show, which is how a message file drifts out of date.
   */
  it("has no error message no schema can produce", () => {
    const reachable = new Set(
      SCHEMAS.flatMap(({ schema, bad }) => bad.flatMap((input) => messagesOf(schema, input))),
    );
    // Not produced by a schema, and reached another way.
    reachable.add("invalid");
    // Screen 85's VAT page prints this one directly rather than from `?error=`.
    reachable.add("rateInvalid");
    // Thrown by `addSeries` as `SeriesRefused`, not by a schema: only the
    // database knows whether this kind already has a series.
    reachable.add("kindTaken");

    const written = Object.keys(en.setup?.error ?? {});
    expect(written.filter((key) => !reachable.has(key))).toEqual([]);
  });
});
