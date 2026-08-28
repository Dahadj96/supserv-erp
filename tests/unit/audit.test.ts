import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTOR_KINDS, changedFields, isActorKind } from "@/domain/control/audit";

/**
 * Screen 32 — the audit log.
 *
 * The diff is what makes the screen worth opening. Sixty-four call sites write
 * `before` and `after` with no agreed shape between them, so the reader has to
 * cope with all of them and never print `[object Object]`, an empty row, or a
 * change that is not one.
 */
const root = join(import.meta.dirname, "..", "..");

const load = (locale: string) =>
  JSON.parse(readFileSync(`${root}/src/i18n/messages/${locale}.json`, "utf8"));

function get(obj: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((o, part) => {
    if (typeof o !== "object" || o === null) return undefined;
    return (o as Record<string, unknown>)[part];
  }, obj);
}

describe("what changed, across the four shapes call sites actually write", () => {
  it("reads a plain edit", () => {
    expect(changedFields({ rc: "16/00", nif: "099" }, { rc: "16/01", nif: "099" })).toEqual([
      { field: "rc", before: "16/00", after: "16/01" },
    ]);
  });

  it("reads a creation, which records only `after`", () => {
    expect(changedFields(null, { code: "CL-0031" })).toEqual([
      { field: "code", before: null, after: "CL-0031" },
    ]);
  });

  it("reads a discard, which records only `before`", () => {
    expect(changedFields({ code: "CL-0031" }, null)).toEqual([
      { field: "code", before: "CL-0031", after: null },
    ]);
  });

  it("says nothing when neither side was recorded", () => {
    // Distinct from "recorded and identical" — the screen prints a different
    // sentence for each, because one is a gap in the trail and one is not.
    expect(changedFields(null, null)).toEqual([]);
    expect(changedFields(undefined, undefined)).toEqual([]);
  });

  it("reports no change when both sides were recorded and match", () => {
    expect(changedFields({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it("sorts fields so two readings of the same row agree", () => {
    const changes = changedFields({ z: 1, a: 1 }, { z: 2, a: 2 });
    expect(changes.map((c) => c.field)).toEqual(["a", "z"]);
  });
});

describe("no value is ever rendered as [object Object]", () => {
  it("shows an array as a list", () => {
    // `reviseFooter` writes `footerMentions: string[]` on both sides.
    const changes = changedFields({ footerMentions: [] }, { footerMentions: ["TVA", "RC"] });
    expect(changes).toEqual([{ field: "footerMentions", before: "", after: "TVA, RC" }]);
  });

  it("shows a nested object as JSON rather than as a type name", () => {
    const changes = changedFields({ m: { a: 1 } }, { m: { a: 2 } });
    expect(changes[0]?.after).toBe('{"a":2}');
    expect(changes[0]?.after).not.toContain("object Object");
  });

  it("keeps false and zero, which are values and not absences", () => {
    // `display` returning null for these would render them as "nothing", and
    // "auto-classify went from true to nothing" is a different claim from
    // "auto-classify was switched off".
    const changes = changedFields({ on: true, n: 1 }, { on: false, n: 0 });
    expect(changes).toEqual([
      { field: "n", before: "1", after: "0" },
      { field: "on", before: "true", after: "false" },
    ]);
  });

  it("does not mistake a top-level array or string for a record", () => {
    expect(changedFields(["a"], ["b"])).toEqual([]);
    expect(changedFields("before", "after")).toEqual([]);
  });
});

describe("the actor kinds", () => {
  it("names the three the schema allows", () => {
    expect(ACTOR_KINDS).toEqual(["user", "assistant", "system"]);
  });

  it("refuses anything else, because the value reaches a query", () => {
    expect(isActorKind("user")).toBe(true);
    expect(isActorKind("root")).toBe(false);
    expect(isActorKind(undefined)).toBe(false);
  });
});

/**
 * Every `entity:` and `action:` literal written anywhere in `src/` should have
 * a sentence in both languages.
 *
 * The screen falls back to the raw value with `t.has`, so a gap is not a crash
 * — it is `intake_dossier` in a French table, which is worse in a different
 * way: it looks like the system leaking its own schema at somebody.
 */
describe("every audited entity and action reads as words", () => {
  const en = load("en");
  const fr = load("fr");

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }

  const entities = new Set<string>();
  const actions = new Set<string>();
  for (const file of walk(join(root, "src"))) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/\bentity:\s*"([^"]+)"/g)) entities.add(m[1] as string);
    for (const m of source.matchAll(/\baction:\s*"([^"]+)"/g)) actions.add(m[1] as string);
  }

  it("found the literals at all", () => {
    expect(entities.size).toBeGreaterThan(20);
    expect(actions.size).toBeGreaterThan(20);
  });

  it("names every entity in both languages", () => {
    for (const entity of entities) {
      expect(get(en, `audit.entity.${entity}`), `${entity} (English)`).toBeTypeOf("string");
      expect(get(fr, `audit.entity.${entity}`), `${entity} (French)`).toBeTypeOf("string");
    }
  });

  it("names every action in both languages", () => {
    for (const action of actions) {
      expect(get(en, `audit.action.${action}`), `${action} (English)`).toBeTypeOf("string");
      expect(get(fr, `audit.action.${action}`), `${action} (French)`).toBeTypeOf("string");
    }
  });
});
