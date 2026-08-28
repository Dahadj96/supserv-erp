import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLACEHOLDERS, render, scan } from "@/domain/email/placeholders";
import { SEED_EMAIL_TEMPLATES, TEMPLATE_LOCALES } from "@/domain/email/templates";

/**
 * Screen 59 — the two things that make a template language safe.
 *
 * One: the vocabulary is closed, so a typo is caught at save time rather than
 * going out in an email as literal braces.
 *
 * Two: nothing that fails to resolve becomes an empty string. A relance that
 * silently loses the invoice number reads perfectly well and is worthless; one
 * that still says `{invoice.number}` gets fixed before it is sent.
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

describe("the placeholder vocabulary is closed", () => {
  it("finds the placeholders a body uses, once each", () => {
    const found = scan("Bonjour {client.name}, votre facture {invoice.number}. {client.name}");
    expect(found.used).toEqual(["client.name", "invoice.number"]);
  });

  it("separates the ones it knows from the ones it does not", () => {
    const found = scan("{client.name} {client.nom}");
    expect(found.known).toEqual(["client.name"]);
    expect(found.unknown).toEqual(["client.nom"]);
  });

  it("leaves prose that merely contains a brace alone", () => {
    // A template that talks about JSON, or writes `{` for any other reason,
    // must not become a parse error or lose the character.
    const text = "Le fichier commence par { et finit par }. Voir {not a token}.";
    expect(scan(text).used).toEqual([]);
    expect(render(text, {}).text).toBe(text);
  });

  it("substitutes nothing that is not a declared name", () => {
    // The whole safety argument. No expression, no lookup by arbitrary key.
    const out = render("{process.env} {constructor.name} {__proto__.x}", {});
    expect(out.text).toBe("{process.env} {constructor.name} {__proto__.x}");
  });
});

describe("what render leaves standing, and why", () => {
  it("fills in a known field from a real value", () => {
    const out = render("De la part de {us.name}.", { "us.name": "SARL SUPSERV" });
    expect(out.text).toBe("De la part de SARL SUPSERV.");
    expect(out.left).toEqual([]);
  });

  it("keeps a field the caller had no record for, and says so", () => {
    const out = render("Bonjour {client.name}", { "us.name": "SARL SUPSERV" });
    expect(out.text).toBe("Bonjour {client.name}");
    expect(out.left).toEqual([{ name: "client.name", reason: "noRecord" }]);
  });

  it("keeps a field whose real value is blank, and calls that something else", () => {
    // The company exists but has no RC recorded yet. That is a different fault
    // from "no record in hand", and the screen says a different thing about it.
    const out = render("RC {us.rc}", { "us.rc": null });
    expect(out.text).toBe("RC {us.rc}");
    expect(out.left).toEqual([{ name: "us.rc", reason: "empty" }]);
  });

  it("never turns an unresolved field into an empty string", () => {
    const out = render("Facture {invoice.number} due le {invoice.dueDate}", {});
    expect(out.text).not.toContain("  ");
    expect(out.text).toContain("{invoice.number}");
    expect(out.text).toContain("{invoice.dueDate}");
  });
});

describe("the vocabulary is honest about what Settings can resolve", () => {
  it("only claims the groups that need no counterparty", () => {
    for (const placeholder of PLACEHOLDERS) {
      const fromUsOrMe = placeholder.group === "us" || placeholder.group === "me";
      expect(placeholder.resolvable, placeholder.name).toBe(fromUsOrMe);
    }
  });

  it("has a name that the scanner would actually match", () => {
    for (const placeholder of PLACEHOLDERS) {
      expect(scan(`{${placeholder.name}}`).known, placeholder.name).toEqual([placeholder.name]);
    }
  });
});

describe("every seeded template says what it is and when it is for", () => {
  const en = load("en");
  const fr = load("fr");

  it("names each one in both languages", () => {
    for (const seed of SEED_EMAIL_TEMPLATES) {
      for (const [locale, messages] of [
        ["en", en],
        ["fr", fr],
      ] as const) {
        expect(
          get(messages, `emailTemplates.name.${seed.key}`),
          `${seed.key} (${locale})`,
        ).toBeTypeOf("string");
        expect(
          get(messages, `emailTemplates.when.${seed.key}`),
          `${seed.key} (${locale})`,
        ).toBeTypeOf("string");
      }
    }
  });

  it("seeds a row per language, and no wording", () => {
    // `ensureEmailTemplatesExist` writes one blank row per (key, locale). If
    // this list ever grows a body, the seed has started inventing SUPSERV's
    // commercial wording, which is the thing it exists not to do.
    expect(TEMPLATE_LOCALES).toEqual(["fr", "en"]);
    for (const seed of SEED_EMAIL_TEMPLATES) {
      expect(Object.keys(seed).sort()).toEqual(["key", "scope"]);
    }
  });

  it("has no duplicate keys", () => {
    const keys = SEED_EMAIL_TEMPLATES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
