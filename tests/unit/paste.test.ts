import { describe, expect, it } from "vitest";
import { isUnit, looksLikeReference, parsePaste, readQty } from "@/domain/deal/paste";

/**
 * Screen 06 — what the client actually sends, and what it has to become.
 *
 * The fixtures below are the six shapes an RFQ arrives in at this office. The
 * cost of getting this wrong is somebody retyping fourteen valve references at
 * five o'clock, which is where wrong quantities come from.
 */

describe("reading a quantity the way this office writes them", () => {
  it("takes plain, grouped and decimal", () => {
    expect(readQty("12")).toBe("12");
    expect(readQty("1 000")).toBe("1000");
    expect(readQty("1.000")).toBe("1000");
    expect(readQty("2,5")).toBe("2.5");
    expect(readQty("2.5")).toBe("2.5");
  });

  it("treats three digits after the separator as thousands, not a fraction", () => {
    // `1,500` is fifteen hundred in a spreadsheet written in Adrar. A reader
    // that decides it is one and a half orders 998 fewer than the client asked.
    expect(readQty("1,500")).toBe("1500");
  });

  it("refuses what is not a number", () => {
    expect(readQty("douze")).toBeNull();
    expect(readQty("")).toBeNull();
    expect(readQty("12pc")).toBeNull();
  });
});

describe("telling a reference from a size", () => {
  it("accepts what clients actually write", () => {
    for (const ref of ["VP-DN80-16", "RAC-BR-2", "JT-EPDM-80", "3000116322", "25/DA/2026"]) {
      expect(looksLikeReference(ref), ref).toBe(true);
    }
  });

  it("refuses a size, which is part of the designation", () => {
    // The important one. `DN80` in the reference column of every offer is a
    // whole afternoon of somebody deleting it again.
    for (const notRef of ["DN80", "PN16", "Vanne", "M16", "2026"]) {
      expect(looksLikeReference(notRef), notRef).toBe(false);
    }
  });
});

describe("units", () => {
  it("knows the ones this office writes, accents and case aside", () => {
    for (const unit of ["pc", "PC", "pièces", "Lot", "ml", "kg", "u", "jeu"]) {
      expect(isUnit(unit), unit).toBe(true);
    }
    expect(isUnit("PN16")).toBe(false);
  });
});

/** Pasted out of Excel, headers and all. Tabs shown explicitly. */
const FROM_EXCEL = [
  "Réf.\tDésignation\tQté\tUnité",
  "VP-DN80-16\tVanne papillon DN80 PN16, corps fonte\t12\tpc",
  "VP-DN100-16\tVanne papillon DN100 PN16, corps fonte\t8\tpc",
  'RAC-BR-2\tRaccord bride 2" acier galvanisé\t40\tpc',
  "JT-EPDM-80\tJoint EPDM DN80\t60\tpc",
  "BLN-M16\tBoulonnerie M16 galvanisée (lot)\t20\tlot",
].join("\n");

/** Typed into the body of an email. */
const FROM_EMAIL = `Bonjour,

Merci de nous faire parvenir votre meilleure offre pour :

1. VP-DN80-16 Vanne papillon DN80 PN16, corps fonte — 12 pc
2. RAC-BR-2 Raccord bride 2" acier galvanisé : 40 pc
3. Joint EPDM DN80 x 60
- Boulonnerie M16 galvanisée (lot) 20 lot
- Vanne à soupape DN50

Cordialement`;

describe("a table pasted out of Excel", () => {
  const paste = parsePaste(FROM_EXCEL);

  it("knows it is a table", () => {
    expect(paste.shape).toBe("tabs");
    expect(paste.lines).toHaveLength(5);
  });

  it("drops the header row without counting it as an item", () => {
    expect(paste.lines.some((l) => l.designation.includes("Désignation"))).toBe(false);
  });

  it("puts each column where it belongs", () => {
    expect(paste.lines[0]).toMatchObject({
      position: 1,
      reference: "VP-DN80-16",
      designation: "Vanne papillon DN80 PN16, corps fonte",
      qty: "12",
      unit: "pc",
      qtyAssumed: false,
    });
    expect(paste.lines[4]).toMatchObject({ reference: "BLN-M16", qty: "20", unit: "lot" });
  });

  it("keeps the client's numbering by keeping their order", () => {
    expect(paste.lines.map((l) => l.position)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("a list typed into an email", () => {
  const paste = parsePaste(FROM_EMAIL);

  it("finds the five items and ignores the greeting", () => {
    expect(paste.shape).toBe("prose");
    expect(paste.lines).toHaveLength(5);
    // "Bonjour," and "Cordialement" are not items, and they are REPORTED as
    // ignored rather than silently dropped — a person can see what was skipped.
    expect(paste.ignored.length).toBeGreaterThan(0);
  });

  it("reads the numbered lines and reports the prose it skipped", () => {
    expect(paste.lines[0]).toMatchObject({
      reference: "VP-DN80-16",
      designation: "Vanne papillon DN80 PN16, corps fonte",
      qty: "12",
      unit: "pc",
      readAs: "numbered",
    });
    expect(paste.ignored).toContain("Bonjour,");
    expect(paste.ignored).toContain("Cordialement");
  });

  it("takes a quantity written with a colon or an x", () => {
    expect(paste.lines[1]).toMatchObject({ qty: "40", unit: "pc" });
    // "Joint EPDM DN80 x 60" — no unit given, and none invented.
    expect(paste.lines[2]).toMatchObject({ designation: "Joint EPDM DN80", qty: "60", unit: null });
  });

  it("does not mistake a size for a quantity", () => {
    // `Vanne papillon DN80 PN16` ends in a number-ish token. A greedy reader
    // takes PN16 as the quantity and quotes sixteen valves instead of twelve.
    expect(paste.lines[0]?.designation).toContain("PN16");
  });

  it("says when it assumed a quantity of one rather than pretending", () => {
    const last = paste.lines[4];
    expect(last?.designation).toBe("Vanne à soupape DN50");
    expect(last?.qty).toBe("1");
    expect(last?.qtyAssumed).toBe(true);
  });
});

describe("a bare list with nothing marked", () => {
  it("takes every line, because there is nothing to tell them apart", () => {
    const paste = parsePaste(
      ["Vanne papillon DN80", 'Raccord bride 2"', "Joint EPDM DN80 60 pc"].join("\n"),
    );
    expect(paste.lines).toHaveLength(3);
    expect(paste.lines[2]).toMatchObject({ qty: "60", unit: "pc" });
  });

  it("returns nothing at all for nothing at all", () => {
    expect(parsePaste("   \n\n  ")).toEqual({ lines: [], ignored: [], shape: "empty" });
  });
});

/**
 * A table that came out of a PDF.
 *
 * `text-layer.ts` joins pdf.js's positioned fragments with single spaces, so a
 * bordereau's five columns arrive as one line and the row number has no `.` or
 * `)` after it — the document never had one, the number sat in its own cell.
 * Until this was read, every such row kept its index inside the designation and
 * every offer built from a PDF said "1 Vanne papillon DN80".
 */
describe("a table read out of a PDF, where the row number lost its punctuation", () => {
  it("takes a leading number as an index when a reference follows it", () => {
    const paste = parsePaste(
      [
        "1 VP-DN80-16 Vanne papillon DN80 PN16 12 pc",
        "2 RAC-BR-2 Raccord à brides 2 pouces 40 pc",
      ].join("\n"),
    );

    expect(paste.lines).toHaveLength(2);
    expect(paste.lines[0]).toMatchObject({
      reference: "VP-DN80-16",
      designation: "Vanne papillon DN80 PN16",
      qty: "12",
      unit: "pc",
      readAs: "numbered",
    });
    expect(paste.lines[1]?.reference).toBe("RAC-BR-2");
  });

  it("takes it as an index when the line ends in a quantity", () => {
    const paste = parsePaste("1 Vanne papillon DN80 PN16 12 pc\n2 Joint EPDM DN80 24 pc");

    expect(paste.lines[0]).toMatchObject({
      reference: null,
      designation: "Vanne papillon DN80 PN16",
      qty: "12",
      readAs: "numbered",
    });
    expect(paste.lines[1]?.designation).toBe("Joint EPDM DN80");
  });

  it("leaves the number alone when it is the quantity", () => {
    // Nothing follows it that says "table row": no reference, no count at the
    // end. Twelve bolts, not bolt number twelve.
    const paste = parsePaste("12 boulons M16");

    expect(paste.lines[0]).toMatchObject({
      designation: "12 boulons M16",
      qty: "1",
      qtyAssumed: true,
      readAs: "bare",
    });
  });

  it("leaves a designation that simply begins with a number alone", () => {
    const paste = parsePaste("2 pouces raccord galvanisé");

    expect(paste.lines[0]?.designation).toBe("2 pouces raccord galvanisé");
  });
});
