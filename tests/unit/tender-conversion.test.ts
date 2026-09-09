import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROCEDURES } from "@/domain/tender/dossier";
import { seedFor } from "@/domain/tender/pieces";
import { UNMAKE_REFUSALS, unmakeRefusalFor } from "@/domain/tender/store";

/**
 * Screen 06's conversion, without a database.
 *
 * Two things are worth pinning here and neither needs Postgres: that every
 * value the form can post has a label in both languages, and that the undo
 * refuses on exactly the facts nobody could reconstruct afterwards.
 */
const root = join(import.meta.dirname, "..", "..");
const load = (locale: string) =>
  JSON.parse(readFileSync(join(root, "src/i18n/messages", `${locale}.json`), "utf8"));
const en = load("en");
const fr = load("fr");

describe("the procedures the form offers", () => {
  // A FAMILY of keys, built from a template literal on screens 06 and 07, so
  // `messages.test.ts` cannot see them. A sixth procedure added to
  // `PROCEDURES` and not to both message files is a 500 on the deal page.
  it("each has a label in English and in French", () => {
    for (const procedure of PROCEDURES) {
      expect(en.tenders.procedure[procedure], `en ${procedure}`).toBeTruthy();
      expect(fr.tenders.procedure[procedure], `fr ${procedure}`).toBeTruthy();
    }
  });

  it("says what the form's copy claims: an RFQ starts lighter than an AONR", () => {
    // The owner's own distinction — "a simple RFQ" against "a real tender" —
    // is a seed difference and nothing more, and `tender.make.seedHint` names
    // the three pieces. If that ever stops being true the sentence is a lie.
    const light = seedFor("rfq").map((piece) => piece.key);
    const full = seedFor("aonr").map((piece) => piece.key);
    for (const key of ["caution", "qualification", "casier_judiciaire"]) {
      expect(full).toContain(key);
      expect(light).not.toContain(key);
    }
    expect(seedFor("consultation")).toEqual(seedFor("rfq"));
  });
});

describe("what turning a tender back refuses", () => {
  const clean = {
    submittedAt: null,
    depositReceiptRef: null,
    cautionRequestedAt: null,
    cautionReceivedAt: null,
    bpuSource: null,
    bpuImportedAt: null,
  };
  const seeded = [{ fileId: null, label: null }];
  const day = new Date("2026-09-02T10:00:00Z");

  it("allows it while only the seed exists — otherwise nothing is undoable", () => {
    expect(unmakeRefusalFor(clean, seeded)).toBeNull();
    expect(unmakeRefusalFor(clean, [])).toBeNull();
  });

  it("refuses when there is no tender at all", () => {
    expect(unmakeRefusalFor(undefined, [])).toBe("notATender");
  });

  it("refuses once the envelope was deposited, by either fact", () => {
    expect(unmakeRefusalFor({ ...clean, submittedAt: day }, seeded)).toBe("alreadySubmitted");
    expect(unmakeRefusalFor({ ...clean, depositReceiptRef: "REC-88" }, seeded)).toBe(
      "alreadySubmitted",
    );
  });

  it("refuses on a caution REQUESTED, not only one received", () => {
    // The schema calls both "facts nobody can infer: the bank takes days". A
    // request in flight is somebody's week at a counter, and it would go with
    // the row.
    expect(unmakeRefusalFor({ ...clean, cautionRequestedAt: day }, seeded)).toBe("cautionRecorded");
    expect(unmakeRefusalFor({ ...clean, cautionReceivedAt: day }, seeded)).toBe("cautionRecorded");
  });

  it("refuses once a bordereau's provenance is on the row", () => {
    expect(unmakeRefusalFor({ ...clean, bpuSource: "BPU.xls" }, seeded)).toBe("bpuImported");
    expect(unmakeRefusalFor({ ...clean, bpuImportedAt: day }, seeded)).toBe("bpuImported");
  });

  it("refuses once somebody has worked the folder", () => {
    expect(unmakeRefusalFor(clean, [{ fileId: "w/cnas.pdf", label: null }])).toBe("folderStarted");
    // `makeTender`'s seed writes no label; only `addPiece` does. So a label is
    // proof a person read the cahier des charges and typed what it asked for.
    expect(unmakeRefusalFor(clean, [{ fileId: null, label: "Note de méthodologie" }])).toBe(
      "folderStarted",
    );
  });

  it("has a sentence for every refusal, in both languages", () => {
    for (const refusal of UNMAKE_REFUSALS) {
      expect(en.tender.unmake.refused[refusal], `en ${refusal}`).toBeTruthy();
      expect(fr.tender.unmake.refused[refusal], `fr ${refusal}`).toBeTruthy();
      // The action redirects with the same code as `?error=`, and screen 06
      // reads it out of `enquiry.error`.
      expect(en.enquiry.error[refusal], `en enquiry.error.${refusal}`).toBeTruthy();
      expect(fr.enquiry.error[refusal], `fr enquiry.error.${refusal}`).toBeTruthy();
    }
  });
});

/**
 * Nothing about a tender is reachable only by typing a URL.
 *
 * Screen 06 contained the word "tender" nought times, so a deal answering a
 * formal procedure looked exactly like one that was not, and neither its
 * folder (08) nor the bordereau import (42) was linked from anywhere but
 * itself. The item-list builder (73) was orphaned in the same way. Four
 * `<Link>`s fix that and one deletion would undo it silently, which is what
 * this holds.
 */
describe("screen 06 leads where a tender goes next", () => {
  const app = join(root, "src/app");

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (full.endsWith(".tsx")) out.push(full);
    }
    return out;
  }

  const screens = walk(app).map((file) => readFileSync(file, "utf8"));
  const deal = readFileSync(join(app, "[locale]/(app)/deals/[id]/page.tsx"), "utf8");

  it("puts the tender's own screens on the deal", () => {
    expect(deal).toContain("`/tenders/${id}`");
    expect(deal).toContain("`/tenders/${id}/bpu`");
    // And says WHICH procedure it is, rather than only that it is one.
    expect(deal).toContain("tender.onDeal.badge");
  });

  it("links the item list, which nothing in the codebase pointed at", () => {
    expect(deal).toContain("`/deals/${id}/items`");
  });

  it("reads the folder from `dossier()` rather than counting pieces again", () => {
    // `getTender` has already run the pure function. A second arithmetic here
    // could disagree with screen 08 about the same folder.
    expect(deal).toContain("tenderOn.folder.percent");
    expect(deal).not.toMatch(/pieces\.filter\([^)]*ready/);
  });

  it("leaves no screen 42 that only screen 42 knows about", () => {
    const linkers = screens.filter((source) => /\/tenders\/\$\{[^}]+\}\/bpu/.test(source));
    expect(linkers.length).toBeGreaterThan(1);
  });
});
