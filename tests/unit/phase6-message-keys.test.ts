import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A missing message key is a 500, not a blank label.
 *
 * `next-intl` throws `MISSING_MESSAGE` from `t()` at render, so a key that
 * exists in English and not in French takes the whole page down for anybody
 * working in French — which is everybody here. That is how `/deals` was a 500
 * for a fortnight over `deals.filters.all`.
 *
 * This reads the literal `t("…")` calls out of the screens added in phase 6 and
 * checks both message files. It deliberately does not try to be clever about
 * template literals: those name FAMILIES of keys, and each family has its own
 * test next to the data that generates it (`files.test.ts`,
 * `email-templates.test.ts`).
 */
const root = join(import.meta.dirname, "..", "..");

const SCREENS = [
  "src/app/[locale]/(app)/files/page.tsx",
  "src/app/[locale]/(app)/settings/storage/page.tsx",
  "src/app/[locale]/(app)/settings/email-templates/page.tsx",
  "src/app/[locale]/(app)/settings/audit/page.tsx",
  "src/app/[locale]/(app)/compliance/page.tsx",
];

const load = (locale: string) =>
  JSON.parse(readFileSync(`${root}/src/i18n/messages/${locale}.json`, "utf8"));

function get(obj: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((o, part) => {
    if (typeof o !== "object" || o === null) return undefined;
    return (o as Record<string, unknown>)[part];
  }, obj);
}

/** `t("a.b")` and `t("a.b", { … })`, double or single quoted. Not backticks. */
const CALL = /\bt\(\s*(["'])([^"'`]+)\1/g;

function keysIn(file: string): string[] {
  const source = readFileSync(join(root, file), "utf8");
  const keys = new Set<string>();
  for (const match of source.matchAll(CALL)) keys.add(match[2] as string);
  return [...keys];
}

describe("every literal message key on the phase 6 screens exists in both languages", () => {
  const en = load("en");
  const fr = load("fr");

  for (const file of SCREENS) {
    const keys = keysIn(file);

    it(`${file} uses keys at all`, () => {
      // If the extractor stops matching — a refactor to a different helper
      // name, say — this test would pass vacuously and protect nothing.
      expect(keys.length).toBeGreaterThan(5);
    });

    it(`${file} resolves every one of them`, () => {
      for (const key of keys) {
        expect(get(en, key), `${key} (English) — used in ${file}`).toBeTypeOf("string");
        expect(get(fr, key), `${key} (French) — used in ${file}`).toBeTypeOf("string");
      }
    });
  }
});
