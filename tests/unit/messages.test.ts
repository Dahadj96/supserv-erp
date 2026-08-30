import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { badgeMessageKey, OUTCOMES, STAGES } from "@/domain/deal/stage";

/**
 * `t()` throws MISSING_MESSAGE at render time, which means a typo in a message
 * key is not a missing label — it is a 500 on that route. It has happened twice
 * (the breadcrumb, then a namespace that was a string on one side and an object
 * on the other), so it is a test now.
 *
 * Only literal keys can be checked here. Keys built from a template literal are
 * checked by the screen's own test, or guarded with `t.has()` at the call site.
 */
const root = resolve(import.meta.dirname, "../..");
const load = (locale: string) =>
  JSON.parse(readFileSync(`${root}/src/i18n/messages/${locale}.json`, "utf8"));

const en = load("en");
const fr = load("fr");

function flatten(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [];
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : flatten(value, path);
  });
}

function get(obj: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((o, part) => {
    if (typeof o !== "object" || o === null) return undefined;
    return (o as Record<string, unknown>)[part];
  }, obj);
}

describe("messages", () => {
  it("has the same keys in French and English", () => {
    const a = flatten(en).sort();
    const b = flatten(fr).sort();
    expect(
      a.filter((k) => !b.includes(k)),
      "in English but not French",
    ).toEqual([]);
    expect(
      b.filter((k) => !a.includes(k)),
      "in French but not English",
    ).toEqual([]);
  });

  it("resolves every literal key used in the interface", () => {
    const missing: string[] = [];
    for (const file of globSync(`${root}/src/**/*.tsx`)) {
      const src = readFileSync(file, "utf8");

      // Which translator variable is scoped to which namespace.
      //   const t     = useTranslations();        → t("scan.title")
      //   const tNav  = useTranslations("nav");   → tNav("inbox")
      //
      // Reading the namespace matters: without it this test resolved `tNav`
      // calls against the root and quietly passed on keys that do not exist.
      const scopes = new Map<string, string>();
      for (const m of src.matchAll(
        /\b(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:"([^"]*)")?\s*\)/g,
      )) {
        if (m[1]) scopes.set(m[1], m[2] ?? "");
      }
      if (scopes.size === 0) scopes.set("t", "");

      for (const [name, namespace] of scopes) {
        const call = new RegExp(`\\b${name}\\(\\s*"([a-zA-Z0-9_.]+)"`, "g");
        for (const match of src.matchAll(call)) {
          const key = namespace ? `${namespace}.${match[1]}` : (match[1] as string);
          if (typeof get(en, key) !== "string") {
            missing.push(`${key}  —  ${file.slice(root.length + 1)}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * The gap the block above admits to, narrowed.
   *
   * A key built as `t(`week.kind.${kind}`)` cannot be resolved statically -
   * `kind` is a value. But the LITERAL PART can be, and a prefix that resolves
   * to nothing is a call site where EVERY value throws, not an unlucky one.
   * That is the whole of the /deals outage: `deals.filters.` had three members
   * and the code needed nine, and `deals.filters.all` had never existed.
   *
   * So: for every template call site, the text before the first `${` must
   * resolve to a group of messages that exists. It does not prove the member
   * is there. It does prove somebody has not renamed a namespace out from
   * under two hundred call sites.
   */
  it("resolves the literal prefix of every key built from a value", () => {
    const broken: string[] = [];

    for (const file of globSync(`${root}/src/**/*.{ts,tsx}`)) {
      const src = readFileSync(file, "utf8");

      const scopes = new Map<string, string>();
      for (const m of src.matchAll(
        /\b(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:"([^"]*)")?\s*\)/g,
      )) {
        if (m[1]) scopes.set(m[1], m[2] ?? "");
      }
      if (scopes.size === 0) scopes.set("t", "");

      for (const [name, namespace] of scopes) {
        // `t(`a.b.${x}`)` and `t.has(`a.b.${x}`)` alike - a guarded call site
        // still needs its namespace to exist, or the guard is answering false
        // for a reason nobody intended.
        const call = new RegExp(`\\b${name}(?:\\.has)?\\(\\s*\`([a-zA-Z0-9_.]*)\\$\\{`, "g");
        for (const match of src.matchAll(call)) {
          const literal = (match[1] as string).replace(/\.$/, "");
          if (literal === "") continue;
          const key = namespace ? `${namespace}.${literal}` : literal;
          const found = get(en, key);
          if (typeof found !== "object" || found === null) {
            broken.push(`${key}  —  ${file.slice(root.length + 1).replaceAll("\\", "/")}`);
          }
        }
      }
    }

    expect(broken, "template keys whose namespace does not exist").toEqual([]);
  });

  /**
   * next-intl 4 throws INVALID_KEY while LOADING the messages when a key name
   * contains a dot, because the dot is how nesting is expressed. One malformed
   * key breaks every page in the app, not just the screen that reads it — and
   * `flatten()` above could never see it, since it joins parents with a dot and
   * so renders `{"a.b": "…"}` and `{a: {b: "…"}}` as the same string.
   *
   * Twelve of these were live for weeks. This is the check that finds them.
   */
  it("has no key name containing a dot", () => {
    const names = (obj: unknown, prefix = ""): string[] => {
      if (typeof obj !== "object" || obj === null) return [];
      return Object.entries(obj).flatMap(([key, value]) => [
        ...(key.includes(".") ? [`${prefix}${key}`] : []),
        ...names(value, `${prefix}${key}.`),
      ]);
    };

    expect(names(en), "English").toEqual([]);
    expect(names(fr), "French").toEqual([]);
  });

  it("never leaves a namespace as both a string and an object", () => {
    // `merge.after` was briefly a column header AND a group of six labels.
    // next-intl cannot hold both, and the second one silently wins.
    const clashes = flatten(en).filter((key) => {
      const parent = key.split(".").slice(0, -1).join(".");
      return parent.length > 0 && typeof get(en, parent) === "string";
    });
    expect(clashes).toEqual([]);
  });
});

/**
 * The gap the block above admits to: "only literal keys can be checked here".
 *
 * That gap shipped a 500. Screen 05 built `deals.filters.${badge}` by hand for
 * a badge that can be any of nine values - and three of them (won, lost,
 * noBid) do not live under `deals.filters`, while the "All" chip built
 * `deals.filters.all`, which has never existed in either language. So /deals
 * threw MISSING_MESSAGE on every render, in both locales, and the deal page
 * threw for every enquiry that had been won.
 *
 * The lookup now lives in `badgeMessageKey`, so it can be tested exhaustively -
 * which is the only reason moving it there was worth doing.
 */
describe("every badge a deal can carry has a label", () => {
  const ALL_BADGES = [...STAGES, ...OUTCOMES];

  it("covers all nine values, in both languages", () => {
    for (const badge of ALL_BADGES) {
      const key = badgeMessageKey(badge);
      expect(get(en, key), `${badge} -> ${key} (English)`).toBeTypeOf("string");
      expect(get(fr, key), `${badge} -> ${key} (French)`).toBeTypeOf("string");
    }
  });

  it("labels the All chip, which is not a stage and never had a key", () => {
    expect(get(en, "deals.all")).toBeTypeOf("string");
    expect(get(fr, "deals.all")).toBeTypeOf("string");
  });

  it("leaves no screen building a deals.filters key by hand", () => {
    // The pattern itself, banned. A template literal cannot be typechecked, so
    // the only durable fix is that nobody writes one for these labels again.
    // Comments stripped first, and this is the second time that has been
    // necessary: a ban that a COMMENT can trip is a ban that fires on the
    // documentation explaining why the ban exists. Screen 66's backup card
    // cites this exact bug in a comment about why it uses a lookup table, and
    // was failed by the test it was obeying.
    const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

    const offenders = globSync(`${root}/src/**/*.{ts,tsx}`)
      .filter((file) => code(readFileSync(file, "utf8")).includes("deals.filters.${"))
      .map((file) => file.slice(root.length + 1).replaceAll("\\", "/"))
      // The one place allowed to build it: the function everything else calls.
      .filter((file) => file !== "src/domain/deal/stage.ts");

    expect(offenders, "use badgeMessageKey instead").toEqual([]);
  });
});
