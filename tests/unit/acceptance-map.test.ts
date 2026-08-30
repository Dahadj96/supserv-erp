import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * docs/ACCEPTANCE.md answers each phase's "Done when" sentence by naming the
 * tests that prove it. This checks that those tests exist.
 *
 * The same lesson as docs/SCREENS.md, and it matters more here. A screen map
 * that drifts sends somebody to the wrong file. A document that says the plan
 * is finished, citing tests that were renamed six weeks ago, is how a project
 * gets declared done twice and delivered never. So every citation is resolved:
 * the file must exist, and the test title must appear in it.
 *
 * It does not check that the test passes - `pnpm test` does that, and this
 * file is part of the same run.
 */
const root = join(import.meta.dirname, "..", "..");
const doc = readFileSync(join(root, "docs/ACCEPTANCE.md"), "utf8");

/** ``- `tests/integration/x.test.ts` :: "a title"`` */
const citations = [...doc.matchAll(/`(tests\/[^`]+\.test\.ts)`\s*::\s*"([^"]+)"/g)].map((m) => ({
  file: m[1] as string,
  title: m[2] as string,
}));

describe("every phase's Done when names tests that exist", () => {
  it("read the document at all", () => {
    // A regex that stopped matching would make every assertion below vacuous -
    // the failure mode where a green suite proves nothing.
    expect(citations.length).toBeGreaterThan(50);
  });

  it("covers all eight phases", () => {
    for (let phase = 0; phase <= 7; phase++) {
      expect(doc, `no section for phase ${phase}`).toContain(`## Phase ${phase} —`);
    }
  });

  it("quotes the Done when sentence from the plan for each phase", () => {
    // Not the sentences themselves - those are prose and would need updating in
    // two places. The blockquote marker, so a phase section cannot quietly lose
    // the criterion it is supposed to be answering.
    const sections = doc.split(/^## Phase /m).slice(1);
    expect(sections).toHaveLength(8);
    for (const section of sections) {
      expect(section.split("\n").filter((l) => l.startsWith("> ")).length).toBeGreaterThan(0);
    }
  });

  it("cites no test file that does not exist", () => {
    const missing = [...new Set(citations.map((c) => c.file))].filter(
      (file) => !existsSync(join(root, file)),
    );
    expect(missing, "files named in ACCEPTANCE.md that are not on disk").toEqual([]);
  });

  it("cites no test title that does not exist", () => {
    const missing: string[] = [];
    const cache = new Map<string, string>();

    for (const { file, title } of citations) {
      const path = join(root, file);
      if (!existsSync(path)) continue; // reported by the test above
      if (!cache.has(file)) cache.set(file, readFileSync(path, "utf8"));
      // The title as written in the source, including its quotes, so a
      // substring of a longer title cannot pass for it.
      if (!(cache.get(file) as string).includes(`"${title}"`)) {
        missing.push(`${file} :: "${title}"`);
      }
    }

    expect(missing, "tests named in ACCEPTANCE.md that no longer exist").toEqual([]);
  });

  it("still says out loud what is not done", () => {
    // The section that makes the rest of the document trustworthy. If somebody
    // deletes it to make the file read better, this fails - which is the point.
    expect(doc).toContain("## What is not a phase, and is still not done");
    expect(doc).toContain("Day one has never been run");
    expect(doc).toContain("Not proved here");
  });
});
