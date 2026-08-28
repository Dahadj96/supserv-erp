import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMIT_BLOCKER, commitAvailability } from "@/domain/intake/commit";
import { ROUTED_TO } from "@/domain/intake/routing";

/**
 * The inbox buttons told people to wait for phases that had already shipped.
 *
 * `COMMIT_PHASE` was written in phase 2 — `enquiry: 4`, `payment: 5` — and then
 * never revisited. Phase 4 closed on 24 August and phase 5 on the 26th, and on
 * the 27th "Create enquiry" was still greyed out saying *coming in phase 4*
 * while the deals it needed had existed for days.
 *
 * A phase number is a promise about the future that nobody owns. It is now a
 * message key naming what is actually missing, which rots more slowly: the
 * person who builds the missing thing deletes the line, because the line
 * describes their work rather than a date.
 *
 * These tests are the second half of that. The first is that the key has to
 * exist in both languages, which means writing a sentence — and writing the
 * sentence is where you notice you no longer believe it.
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

describe("every blocker explains itself, in both languages", () => {
  const en = load("en");
  const fr = load("fr");

  it("covers every classification the router can produce", () => {
    for (const kind of ROUTED_TO) {
      expect(COMMIT_BLOCKER, `${kind} is missing from COMMIT_BLOCKER`).toHaveProperty(kind);
    }
  });

  it("names a real message key when it blocks", () => {
    for (const [kind, key] of Object.entries(COMMIT_BLOCKER)) {
      if (key === null) continue;
      expect(get(en, key), `${kind} -> ${key} (English)`).toBeTypeOf("string");
      expect(get(fr, key), `${kind} -> ${key} (French)`).toBeTypeOf("string");
    }
  });

  it("never uses a phase number again", () => {
    // The whole point. A number cannot be checked against reality; a sentence
    // has to be read by somebody before it is written.
    for (const key of Object.values(COMMIT_BLOCKER)) {
      expect(key === null || Number.isNaN(Number(key))).toBe(true);
    }
  });
});

describe("what can be committed today", () => {
  it("lets an enquiry and a tender become a deal", () => {
    // Phase 4 closed. These were the two that lied the longest.
    expect(commitAvailability("enquiry").available).toBe(true);
    expect(commitAvailability("tender").available).toBe(true);
  });

  it("still refuses the two that need something chosen, not guessed", () => {
    // Both destinations exist. What is missing is a person saying WHICH — which
    // sourcing request, which invoice. Guessing either is how a quote prices
    // the wrong offer and a payment lands on the wrong client's account.
    expect(commitAvailability("supplierQuote").available).toBe(false);
    expect(commitAvailability("payment").available).toBe(false);
  });

  it("offers nothing to create for something nobody has classified", () => {
    expect(commitAvailability(null)).toEqual({ available: false, blocker: null });
    // `needsReview` is reclassify-then-commit; there is no record it becomes.
    expect(commitAvailability("needsReview").available).toBe(true);
  });
});
