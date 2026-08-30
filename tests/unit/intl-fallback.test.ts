import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { logIntlError, messageFallback } from "@/i18n/fallback";

/**
 * A missing label must degrade, visibly, on BOTH sides of the client boundary.
 *
 * next-intl throws MISSING_MESSAGE by default, and in a server component that
 * throw is a 500 on the whole route. `messages.test.ts` catches every literal
 * key before it ships and a lookup function covers the ones built from a
 * value, but 297 call sites build a key from a template and one of them will
 * eventually be handed a value nobody enumerated. When that happens the screen
 * must show a bracketed key and keep working.
 *
 * The tests below are as much about the arrangement as the function: the
 * provider must be the wrapped one, because a bare NextIntlClientProvider
 * silently gets next-intl's throwing default while the server components
 * beside it degrade - the same missing key breaking a form and marking a
 * heading, depending on which side of a boundary read it.
 */
const root = join(import.meta.dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/** Source with its comments removed. See the last test in this file for why. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("a missing message shows the key instead of taking the screen down", () => {
  it("renders the full path, in brackets", () => {
    expect(messageFallback({ namespace: "deals.filters", key: "won" })).toBe("[deals.filters.won]");
  });

  it("works with no namespace", () => {
    expect(messageFallback({ key: "nav.inbox" })).toBe("[nav.inbox]");
  });

  it("is never blank", () => {
    // The whole point. A blank label is invisible, and a person cannot report
    // what they cannot see - which is how one survives for months.
    for (const input of [
      { key: "" },
      { namespace: "", key: "" },
      { namespace: undefined, key: "x" },
    ]) {
      expect(messageFallback(input).length).toBeGreaterThan(1);
    }
  });

  it("says something on every error it is given", () => {
    const said: string[] = [];
    const original = console.error;
    console.error = (line: string) => said.push(line);
    try {
      logIntlError({ code: "MISSING_MESSAGE", message: "deals.filters.won" });
      logIntlError({ code: "INVALID_KEY" });
    } finally {
      console.error = original;
    }
    expect(said).toHaveLength(2);
    expect(said[0]).toContain("MISSING_MESSAGE");
    expect(said[1]).toContain("INVALID_KEY");
  });
});

describe("both sides are wired to it", () => {
  it("the server request config uses the shared fallback", () => {
    const src = read("src/i18n/request.ts");
    expect(src).toContain("getMessageFallback: messageFallback");
    expect(src).toContain("onError: logIntlError");
  });

  it("the layout renders the wrapped provider, not the bare one", () => {
    // A bare NextIntlClientProvider takes no onError and no fallback, so every
    // client component goes back to throwing while the server ones do not.
    const layout = code(read("src/app/[locale]/layout.tsx"));
    expect(layout).toContain("<IntlProvider");
    expect(layout).not.toContain("<NextIntlClientProvider");
  });

  it("the layout hands the provider its messages", () => {
    // The failure this pins down: a NextIntlClientProvider rendered from
    // inside a "use client" module inherits NOTHING from the request config,
    // so it comes up with no messages and every screen breaks. The build
    // caught it - two pages failed to prerender - and it must stay caught by
    // something faster than a build.
    const layout = code(read("src/app/[locale]/layout.tsx"));
    expect(layout).toContain("getMessages()");
    expect(layout).toContain("messages={messages}");
    expect(layout).toContain("locale={locale}");
  });

  it("the wrapper passes both functions through", () => {
    const provider = read("src/i18n/client-provider.tsx");
    expect(provider).toContain("onError={logIntlError}");
    expect(provider).toContain("getMessageFallback={messageFallback}");
  });

  it("keeps the shared module free of anything the client bundle cannot take", () => {
    // Imported from a "use client" file, so a server-only import here would
    // break the build pointing at the wrong file.
    //
    // Comments stripped first. This is the THIRD time today a check has failed
    // on the prose explaining it - the ban on `deals.filters.${...}` did it
    // twice - so the rule is now explicit: a test that searches source for a
    // forbidden string searches the CODE, never the commentary.
    const shared = code(read("src/i18n/fallback.ts"));
    expect(shared).not.toContain("server-only");
    expect(shared).not.toContain("next/headers");
    expect(shared).not.toContain('from "@/db');
  });
});
