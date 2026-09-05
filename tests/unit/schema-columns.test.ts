import { describe, expect, it } from "vitest";
import { readCorpus, readSchemaColumns } from "../../scripts/lib/schema-columns.mjs";

/**
 * Every column, and whether the application is joined up to it.
 *
 * `audit-actions` asks whether an action checks who is calling; `audit-forms`
 * whether a field somebody typed goes anywhere. This asks the third question,
 * one screen further down: is the column itself connected?
 *
 * It exists because `project.closed_at` was read in three places and written in
 * none, and nothing anywhere went red. The only symptom was that no marché
 * could ever leave its warranty.
 *
 * The script is `pnpm audit:schema`. This holds the parser to the two things a
 * static reader can quietly stop doing — finding the columns at all, and
 * finding the code that uses them — because a reader that finds nothing
 * reports a clean database.
 */
const columns = readSchemaColumns();
const corpus = readCorpus();

describe("what the schema declares", () => {
  it("finds the columns at all — a parser that found none would pass everything", () => {
    expect(columns.length).toBeGreaterThan(400);
    expect(new Set(columns.map((c) => c.table)).size).toBeGreaterThan(40);
  });

  it("reads a column the ordinary way, with its property name and its table", () => {
    const held = columns.find((c) => c.table === "project" && c.prop === "retentionPct");
    expect(held).toMatchObject({ variable: "project", file: "src/db/schema/project.ts" });
  });

  it("does not mistake a column's options for columns of their own", () => {
    // `numeric("amount_excl", { precision: 16, scale: 2 })` puts `precision`
    // and `scale` on a line of their own when prettier wraps it. Reading them
    // as columns would be two findings on every money column in the database.
    expect(columns.some((c) => c.prop === "precision" || c.prop === "scale")).toBe(false);
    expect(columns.some((c) => c.prop === "withTimezone")).toBe(false);
  });

  it("keeps every table's columns to itself", () => {
    // Six tables have a `note`. If the parser flattened them the audit could
    // not tell which one a `.note` in the code belongs to — and it does not
    // claim to; but the columns themselves must stay separately addressed.
    const notes = columns.filter((c) => c.prop === "note");
    expect(new Set(notes.map((c) => c.table)).size).toBe(notes.length);
  });

  it("keeps each column's own declaration, so a database default can be seen", () => {
    // `payment.recorded_at` is `defaultNow()`: read everywhere, named in no
    // insert, and not a defect. Telling the two apart needs the modifiers that
    // prettier often wraps onto the lines below the name.
    const recorded = columns.find((c) => c.table === "payment" && c.prop === "recordedAt");
    expect(recorded?.declaration).toMatch(/defaultNow\(\)/);

    const wrapped = columns.find(
      (c) => c.table === "person_certification" && c.prop === "personId",
    );
    expect(wrapped?.declaration).toMatch(/references/);
  });

  it("looks at the application and not at the tests", () => {
    // The whole point. A column whose only writer is a fixture is a column no
    // screen can set — `closedAt` passed a naive version of this audit because
    // a unit test passes `{ closedAt: … }` to `projectState`.
    expect(corpus.length).toBeGreaterThan(200);
    expect(corpus.some((f) => f.path.startsWith("tests/"))).toBe(false);
    expect(corpus.some((f) => f.path.startsWith("src/db/schema/"))).toBe(false);
    expect(corpus.some((f) => f.path.startsWith("src/domain/"))).toBe(true);
  });
});
