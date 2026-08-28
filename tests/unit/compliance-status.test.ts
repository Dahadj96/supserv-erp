import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNTANT_RULES, DECREE_RULES } from "@/documents/compliance";
import { STRUCTURAL } from "@/domain/compliance-profile";

/**
 * Screen 27 — Compliance.
 *
 * The screen's whole claim is that it can tell you two different things: what
 * would be REFUSED at issue, and what would go through anyway because nobody
 * has confirmed the rule. Both readings depend on every rule having a sentence
 * in both languages — a rule that renders as `invoice.stampDutyThreshold` is
 * not a compliance report, it is a stack trace.
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

describe("every rule reads as a sentence, in both languages", () => {
  const en = load("en");
  const fr = load("fr");
  const all = [...DECREE_RULES, ...ACCOUNTANT_RULES];

  it("covers the six rules that exist", () => {
    expect(all).toHaveLength(6);
  });

  it("has the message key each rule names", () => {
    for (const rule of all) {
      expect(get(en, rule.messageKey), `${rule.code} (English)`).toBeTypeOf("string");
      expect(get(fr, rule.messageKey), `${rule.code} (French)`).toBeTypeOf("string");
    }
  });

  it("keys the message on the code, so a finding can find it", () => {
    // Screen 27 renders findings, which carry a `code` and no `messageKey`.
    // It builds `rules.<code>`, so the two have to agree.
    for (const rule of all) {
      expect(rule.messageKey, rule.code).toBe(`rules.${rule.code}`);
    }
  });

  it("names an authority for every rule", () => {
    // Screen 69's argument: the software does not assert a law on its own
    // authority. A rule with no source named is the software doing exactly that.
    for (const rule of all) {
      expect(rule.authority, rule.code).toBeTruthy();
    }
  });

  it("sends every rule somewhere it can be fixed", () => {
    for (const rule of all) {
      expect(rule.fixRoute, rule.code).toMatch(/^\//);
    }
  });
});

describe("confirmed and unconfirmed are genuinely different sets", () => {
  it("the decree confirms itself, and the accountant's four do not", () => {
    // This is the split screen 27 exists to show. If it ever collapsed — every
    // rule confirmed, or none — the second panel would have nothing to say and
    // the screen would be a duplicate of screen 69.
    for (const rule of DECREE_RULES) {
      expect(rule.confirmedBy, rule.code).toBe(rule.authority);
      expect(rule.confirmedOn, rule.code).toBeTruthy();
    }
    for (const rule of ACCOUNTANT_RULES) {
      expect(rule, rule.code).not.toHaveProperty("confirmedOn");
    }
  });
});

describe("the structural guarantees name a file that exists", () => {
  const en = load("en");
  const fr = load("fr");

  it("has a sentence for each", () => {
    for (const item of STRUCTURAL) {
      expect(get(en, `compliance.built.${item.key}`), `${item.key} (English)`).toBeTypeOf("string");
      expect(get(fr, `compliance.built.${item.key}`), `${item.key} (French)`).toBeTypeOf("string");
    }
  });

  it("points at real code", () => {
    // "Enforced by how it is built" is a claim, and a claim naming a file that
    // has been deleted or renamed is worse than no claim.
    for (const item of STRUCTURAL) {
      expect(() => readFileSync(join(root, item.where), "utf8"), item.where).not.toThrow();
    }
  });
});
