import { createTranslator, IntlErrorCode } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import fr from "@/i18n/messages/fr.json";

/**
 * Every message, compiled.
 *
 * next-intl prints a message it cannot parse as its own key — "[setup.patternExamples]"
 * — in the middle of the page, and nothing in the build notices. The
 * screenshot walk found one on the numbering screen; this finds the next one
 * before a browser does. (messages.test.ts keeps the two catalogues in step.)
 */
type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : leaves(value, `${prefix}${key}.`),
  );
}

/** Enough arguments for any message to format: every name it might ask for. */
const ARGS = new Proxy({} as Record<string, unknown>, {
  get: (_, name) =>
    typeof name === "string" ? (/^(n|count|total|days|hidden)$/.test(name) ? 2 : "x") : undefined,
  has: () => true,
});

function compileAll(locale: string, messages: Tree) {
  const invalid: string[] = [];
  const t = createTranslator({
    locale,
    messages,
    onError: (error) => {
      if (error.code === IntlErrorCode.INVALID_MESSAGE) invalid.push(error.message);
    },
    getMessageFallback: ({ key }) => key,
  });
  for (const key of leaves(messages)) {
    try {
      // The catalogue is typed against its own keys; a string from a walk
      // over the same catalogue is one of them.
      (t as (key: string, values?: Record<string, unknown>) => string)(key, ARGS);
    } catch {
      // A formatting error for a value we did not guess is not a broken message.
    }
  }
  return invalid;
}

describe("the message catalogues", () => {
  it("compile in French", () => {
    expect(compileAll("fr", fr as Tree)).toEqual([]);
  });

  it("compile in English", () => {
    expect(compileAll("en", en as Tree)).toEqual([]);
  });
});
