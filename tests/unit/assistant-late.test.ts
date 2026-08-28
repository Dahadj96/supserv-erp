import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IMMINENT_HOURS, type Lateness } from "@/assistant/late";
import { ITEM_KINDS } from "@/domain/today/list";

/**
 * "What is late and why" — PLAN §7's acceptance test for phase 7.
 *
 * The function itself needs a database, so it is exercised by the integration
 * suite. What is tested here is the part that can go quietly wrong without one:
 * the lateness vocabulary staying exhaustive, and every reason having a
 * sentence in both languages.
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

const REASONS: Lateness["reason"][] = [
  "deadlinePassed",
  "deadlineImminent",
  "pastDue",
  "notBilled",
  "unanswered",
];

describe("every reason a thing can be late reads as words", () => {
  const en = load("en");
  const fr = load("fr");

  it("says each one in both languages", () => {
    for (const reason of REASONS) {
      expect(get(en, `assistantLate.${reason}`), `${reason} (English)`).toBeTypeOf("string");
      expect(get(fr, `assistantLate.${reason}`), `${reason} (French)`).toBeTypeOf("string");
    }
  });
});

describe("the lateness map covers every kind of work", () => {
  const source = readFileSync(join(root, "src/assistant/late.ts"), "utf8");

  it("mentions every ItemKind", () => {
    // `LATENESS` is typed `Record<ItemKind, ...>` so TypeScript already refuses
    // an incomplete map. This is the second half: a kind added to the type and
    // silently mapped to `never` would compile and disappear from the answer.
    // Reading the source makes somebody look at the line.
    for (const kind of ITEM_KINDS) {
      expect(source, `${kind} is not in LATENESS`).toContain(`${kind}:`);
    }
  });

  it("uses one idea of soon", () => {
    // Today, the notification feed and this all say 48 hours. Three constants
    // drifting apart is how a thing is urgent on one screen and not on another.
    expect(IMMINENT_HOURS).toBe(48);

    const today = readFileSync(join(root, "src/domain/today/list.ts"), "utf8");
    const notify = readFileSync(join(root, "src/domain/notify/feed.ts"), "utf8");
    expect(today).toContain("48");
    expect(notify).toContain("URGENT_HOURS = 48");
  });
});

describe("the answer is arithmetic, not generation", () => {
  it("calls no model and reaches no network", () => {
    // The decision this file is built on. A model would sometimes be right,
    // always be unverifiable, and would have to be shown the company's
    // correspondence to do a job that subtraction does exactly.
    const source = readFileSync(join(root, "src/assistant/late.ts"), "utf8");
    for (const smell of ["fetch(", "openai", "anthropic", "http://", "https://"]) {
      expect(source.toLowerCase(), `late.ts mentions ${smell}`).not.toContain(smell);
    }
  });
});
