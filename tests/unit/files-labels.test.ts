import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Screen 60's "arrived with" column, and the one thing it must never print.
 *
 * The first version put `belongsTo.label = r.status` for a dossier and
 * `r.becomes` for an import, so the live screen showed a French table with
 * "failed" in it. That is not a missing translation, it is the system leaking
 * its own schema at somebody — the same fault the audit log's entity and action
 * names were written to avoid.
 *
 * These are the enumerated values those two columns can hold. Each needs words
 * in both languages.
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

/** `intake_dossier.status` — the four `src/db/schema/dossier.ts` documents. */
const DOSSIER_STATUS = ["reading", "review", "confirmed", "failed"];

/** `import_batch.becomes` — "What the sheet becomes: party | contact | person". */
const IMPORT_BECOMES = ["party", "contact", "person"];

describe("no enumerated column reaches the screen as a raw value", () => {
  const en = load("en");
  const fr = load("fr");

  it("names every dossier status", () => {
    for (const status of DOSSIER_STATUS) {
      expect(get(en, `files.dossierStatus.${status}`), `${status} (English)`).toBeTypeOf("string");
      expect(get(fr, `files.dossierStatus.${status}`), `${status} (French)`).toBeTypeOf("string");
    }
  });

  it("names every thing an import becomes", () => {
    for (const becomes of IMPORT_BECOMES) {
      expect(get(en, `files.importBecomes.${becomes}`), `${becomes} (English)`).toBeTypeOf(
        "string",
      );
      expect(get(fr, `files.importBecomes.${becomes}`), `${becomes} (French)`).toBeTypeOf("string");
    }
  });

  it("keeps the fallback for a row with nothing else to say", () => {
    // `arrivedWith` ends here when there is no subject and no known enum.
    for (const key of ["message", "dossier", "import"]) {
      expect(get(en, `files.from.${key}`), `${key} (English)`).toBeTypeOf("string");
      expect(get(fr, `files.from.${key}`), `${key} (French)`).toBeTypeOf("string");
    }
  });

  it("the schema comment still lists the statuses this test assumes", () => {
    // If somebody adds a fifth dossier status, the screen falls back to the
    // kind rather than crashing — but this test is where they find out they
    // owe it a sentence.
    const schema = readFileSync(join(root, "src/db/schema/dossier.ts"), "utf8");
    for (const status of DOSSIER_STATUS) {
      expect(schema, `${status} is no longer mentioned in the schema`).toContain(status);
    }
  });
});
