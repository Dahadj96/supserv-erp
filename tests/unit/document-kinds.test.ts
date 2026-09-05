import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ISSUE_PERMISSION } from "@/auth/can";
import { SEED_TYPES } from "@/domain/document-types";

/**
 * A LIST OF DOCUMENT KINDS WITH A KIND IN IT THAT DOES NOT EXIST.
 *
 * `"offer"` was written into five places over three months — the day-one
 * numbering screen, `ISSUE_PERMISSION`, screen 28's offers chart,
 * `SOLD_KINDS` in the price history, and a test fixture. This ERP has no such
 * kind: the catalogue calls a devis `quotation`.
 *
 * Every one of those failed silently. A `WHERE kind = 'offer'` matches nothing
 * and returns an empty chart; a permission entry nobody reaches looks like a
 * decision somebody made; a name in a list of six reads as one of the six. The
 * screen 28 case is the one that mattered: *Aucune offre émise* to a company
 * that had issued them all year, which is a lie a report tells confidently.
 *
 * So the lists are read out of the source and held against the catalogue. The
 * rule is deliberately narrow — an array of nothing but lowercase quoted words,
 * of which at least two are real document kinds — because that shape is a list
 * of kinds and almost nothing else is.
 */
const ROOT = resolve(import.meta.dirname, "../..");
const SRC = join(ROOT, "src");

const KINDS = new Set(SEED_TYPES.map((t) => t.kind));

/**
 * Lists that mix kinds with something that is deliberately not one.
 *
 * `CHAIN` is screen 48's document chain and `payment` is a step in it: money
 * arriving is not a document this system issues. Named here rather than
 * excluded by a rule, so that adding a second exception is a decision.
 */
const ALLOWED_NON_KINDS = new Set(["payment"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      // The message catalogues are keyed by kind among a thousand other things.
      if (name === "messages") continue;
      out.push(...sourceFiles(path));
    } else if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      out.push(path);
    }
  }
  return out;
}

/** `["a", "b", "c"]` — nothing but lowercase quoted words. */
const ARRAY_OF_WORDS = /\[\s*("[a-z][a-z_]*"\s*,\s*)+"[a-z][a-z_]*"\s*,?\s*\]/g;

type Finding = { file: string; list: string; stranger: string };

function strangersIn(files: string[]): Finding[] {
  const found: Finding[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(ARRAY_OF_WORDS)) {
      const members = [...match[0].matchAll(/"([a-z][a-z_]*)"/g)].map((m) => m[1] as string);
      const real = members.filter((m) => KINDS.has(m));
      if (real.length < 2) continue;
      for (const member of members) {
        if (!KINDS.has(member) && !ALLOWED_NON_KINDS.has(member)) {
          found.push({
            file: file.slice(ROOT.length + 1).replace(/\\/g, "/"),
            list: match[0].replace(/\s+/g, " "),
            stranger: member,
          });
        }
      }
    }
  }
  return found;
}

describe("every document kind named in the source is one that exists", () => {
  const files = sourceFiles(SRC);

  it("read the source at all — a scanner that found no files would pass everything", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(KINDS.size).toBeGreaterThan(15);
  });

  it("finds the lists it is meant to find", () => {
    // A regex that stopped matching would make the assertion below vacuous, so
    // this proves it still sees a list it is supposed to see: the kinds a
    // marché's contract can be, in `domain/project/situations.ts`.
    const situations = readFileSync(join(SRC, "domain/project/situations.ts"), "utf8");
    const lists = [...situations.matchAll(ARRAY_OF_WORDS)];
    expect(lists.length).toBeGreaterThan(0);
  });

  it("names no kind the catalogue does not have", () => {
    const strangers = strangersIn(files).map((f) => `${f.file}: "${f.stranger}" in ${f.list}`);
    expect(strangers, "a document kind that does not exist").toEqual([]);
  });

  it("says who may issue every kind, and nobody who may issue one that is not there", () => {
    // `ISSUE_PERMISSION` calls itself exhaustive, and it carried an `offer`
    // line for months. Exhaustive is checkable in both directions.
    const covered = new Set(Object.keys(ISSUE_PERMISSION));
    const missing = [...KINDS].filter((kind) => !covered.has(kind));
    const strangers = [...covered].filter((kind) => !KINDS.has(kind));

    expect(missing, "a kind nobody has decided who may issue").toEqual([]);
    expect(strangers, "a permission for a kind that does not exist").toEqual([]);
  });
});
