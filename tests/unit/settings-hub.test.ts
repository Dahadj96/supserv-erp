import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Screen 29 — the settings hub, after task U3.
 *
 * Abdou's words were "when you take a look at settings, it's not user friendly,
 * it's not clear", and the queue turned that into one rule: every row states
 * what it is for AND its live state — not a name and a link. Nine of the
 * twenty-three rows had no chip at all when that was written.
 *
 * A rule nobody can check is a slogan, so this is the check. It is static — it
 * reads the page and the message files rather than rendering — because what it
 * is defending is a shape somebody adds a row to six months from now, and the
 * cheapest place to be told is the gate.
 */
const root = join(import.meta.dirname, "..", "..");
const hub = readFileSync(join(root, "src/app/[locale]/(app)/settings/page.tsx"), "utf8");
const load = (locale: string) =>
  JSON.parse(readFileSync(`${root}/src/i18n/messages/${locale}.json`, "utf8"));

const en = load("en");
const fr = load("fr");

function get(obj: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((o, part) => {
    if (typeof o !== "object" || o === null) return undefined;
    return (o as Record<string, unknown>)[part];
  }, obj);
}

/** The group keys the page actually renders, read off its own `groups` array. */
function groupKeys(): string[] {
  const array = hub.slice(hub.indexOf("const groups:"));
  // Six spaces is a group's own key. A row's is ten, and most rows are written
  // on one line, so neither can be mistaken for the other.
  return [...array.matchAll(/^ {6}key: "(\w+)",$/gm)].map((m) => m[1] as string);
}

describe("settings hub", () => {
  it("gives every row a live state", () => {
    /*
      `state` was `{ tone, label } | null` and half the rows took the null. The
      type no longer allows it, so this asserts the thing the type cannot: that
      nobody widens it back to make a row easier to add. A row without a state
      is a row a person has to click to learn anything from, which is the whole
      complaint this task exists for.
     */
    expect(hub).not.toMatch(/state:\s*null/);
    expect(hub, "the state is what makes a row readable — keep it required").toContain(
      "state: { tone: BadgeTone; label: string };",
    );
  });

  it("names every group and says what it is for, in both languages", () => {
    const keys = groupKeys();
    // Five today. A count rather than a list: the point is that the loop below
    // ran against something, not which five they are.
    expect(keys.length).toBeGreaterThanOrEqual(5);

    for (const key of keys) {
      expect(get(en, `settings.group.${key}`), `${key} name (English)`).toBeTypeOf("string");
      expect(get(fr, `settings.group.${key}`), `${key} name (French)`).toBeTypeOf("string");
      expect(get(en, `settings.groupWhat.${key}`), `${key} sentence (English)`).toBeTypeOf(
        "string",
      );
      expect(get(fr, `settings.groupWhat.${key}`), `${key} sentence (French)`).toBeTypeOf("string");
    }
  });

  it("says what every row is for, in both languages", () => {
    const entries = Object.keys(get(en, "settings.entry") as Record<string, unknown>);
    for (const key of entries) {
      for (const [locale, messages] of [
        ["English", en],
        ["French", fr],
      ] as const) {
        expect(get(messages, `settings.entry.${key}.name`), `${key} name (${locale})`).toBeTypeOf(
          "string",
        );
        expect(get(messages, `settings.entry.${key}.what`), `${key} what (${locale})`).toBeTypeOf(
          "string",
        );
      }
    }
  });

  it("has a word for every state a chip can print", () => {
    /*
      These are built at the call site rather than from a value, so the messages
      test's literal pass already resolves them in English. This is the French
      half, and the reason it is worth its own line: a chip is the shortest
      thing on the screen and the easiest place for an untranslated string to
      sit unnoticed.
     */
    for (const match of hub.matchAll(/t\("(settings\.state\.\w+)"/g)) {
      const key = match[1] as string;
      expect(get(en, key), `${key} (English)`).toBeTypeOf("string");
      expect(get(fr, key), `${key} (French)`).toBeTypeOf("string");
    }
  });
});
