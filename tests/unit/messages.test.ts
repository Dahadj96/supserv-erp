import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
      for (const match of src.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) {
        const key = match[1] as string;
        if (typeof get(en, key) !== "string") {
          missing.push(`${key}  —  ${file.slice(root.length + 1)}`);
        }
      }
    }
    expect(missing).toEqual([]);
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
