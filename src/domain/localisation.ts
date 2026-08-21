import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Screen 53's coverage panel, counted rather than claimed.
 *
 * The design draws "English — interface 100%", "Français — interface 100%",
 * "العربية — interface 0% — planned". Two of those are facts about files on
 * disk, so they are read from the files. Writing 100% into a template would
 * make the number decorative — it would still say 100% the day somebody adds an
 * English string and forgets the French one.
 */

export type Coverage = {
  locale: string;
  keys: number;
  /** Of the keys that exist in ANY locale, how many this one has. */
  percent: number;
  planned: boolean;
};

const LOCALES = ["fr", "en"] as const;
/** Drawn on the screen, and honest about being empty. */
const PLANNED = ["ar"] as const;

function flatten(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === "string" ? [path] : flatten(child, path);
  });
}

function load(locale: string): string[] {
  const path = resolve(process.cwd(), "src/i18n/messages", `${locale}.json`);
  try {
    return flatten(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return [];
  }
}

export function interfaceCoverage(): Coverage[] {
  const byLocale = new Map(LOCALES.map((locale) => [locale, new Set(load(locale))]));
  const universe = new Set([...byLocale.values()].flatMap((set) => [...set]));
  const total = universe.size || 1;

  const built = LOCALES.map((locale) => {
    const keys = byLocale.get(locale)?.size ?? 0;
    return { locale, keys, percent: Math.round((keys / total) * 100), planned: false };
  });

  const planned = PLANNED.map((locale) => ({ locale, keys: 0, percent: 0, planned: true }));

  return [...built, ...planned];
}

/**
 * The rules about language that the CODE actually applies, separated from the
 * ones the design states as if they were already enforced.
 *
 * `enforced: false` is not a to-do list item — it is a claim about Algerian law
 * or about a tender authority that nobody has confirmed. Screen 69 is where a
 * person turns one of those into something that refuses, and until they do the
 * screen says "not enforced" rather than implying the system is protecting you.
 */
export type LanguageRule = { key: string; enforced: boolean; where: string | null };

export const LANGUAGE_RULES: LanguageRule[] = [
  { key: "documentFollowsCounterparty", enforced: true, where: "src/documents/engine.ts" },
  { key: "amountInWords", enforced: true, where: "src/documents/amount-in-words.ts" },
  { key: "formatFollowsDocument", enforced: true, where: "src/documents/format.ts" },
  { key: "interfaceFollowsPerson", enforced: true, where: "src/auth/session.ts" },
  { key: "neverTranslated", enforced: true, where: null },
  // Claims from the design that no confirmed rule backs.
  { key: "algerianInvoiceLanguage", enforced: false, where: null },
  { key: "tenderLanguage", enforced: false, where: null },
];
