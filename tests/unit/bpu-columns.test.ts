import { describe, expect, it } from "vitest";
import {
  type BpuMapping,
  linesFromSheet,
  missingTargets,
  normaliseHeading,
  proposeBpuMapping,
  readNumber,
} from "@/domain/tender/bpu-columns";

/**
 * Screen 42's mapping card, and the sheet behind it.
 *
 * The headings below are copied off real bordereaux rather than invented: a
 * synonym list that only recognises the headings I would have written is a list
 * that maps nothing on the morning somebody actually uploads a file.
 */

describe("normaliseHeading", () => {
  it("takes the accents and the degree sign off a French heading", () => {
    expect(normaliseHeading("N° de prix")).toBe("n de prix");
    expect(normaliseHeading("Désignation")).toBe("designation");
    expect(normaliseHeading("  Quantité  ")).toBe("quantite");
  });
});

describe("proposeBpuMapping", () => {
  it("maps the six columns of the frame's own bordereau", () => {
    const mapping = proposeBpuMapping([
      "N° de prix",
      "Désignation",
      "Unité",
      "Quantité",
      "Prix unitaire",
      "Montant",
    ]);

    expect(mapping).toEqual({
      "N° de prix": "lineNumber",
      Désignation: "designation",
      Unité: "unit",
      Quantité: "quantity",
      "Prix unitaire": "unitPrice",
      Montant: "amount",
    });
  });

  it("leaves a heading it does not recognise unmapped rather than guessing", () => {
    const mapping = proposeBpuMapping(["N°", "Observations", "Désignation", "Qté"]);
    expect(mapping.Observations).toBeNull();
    expect(mapping["N°"]).toBe("lineNumber");
    expect(mapping.Qté).toBe("quantity");
  });

  it("gives a target to the first heading that claims it, not the last", () => {
    // A sheet with both. Mapping two columns onto `unitPrice` would silently
    // keep whichever the loop saw last, which is the wrong price half the time.
    const mapping = proposeBpuMapping(["N°", "Désignation", "Qté", "Prix unitaire", "PU"]);
    expect(mapping["Prix unitaire"]).toBe("unitPrice");
    expect(mapping.PU).toBeNull();
  });

  it("names what is missing, so the screen can refuse for a stated reason", () => {
    expect(missingTargets(proposeBpuMapping(["Désignation", "Observations"]))).toEqual([
      "lineNumber",
      "quantity",
    ]);
    expect(missingTargets(proposeBpuMapping(["N°", "Désignation", "Qté"]))).toEqual([]);
  });
});

describe("readNumber", () => {
  it("reads the four ways a quantity is written in the same folder", () => {
    expect(readNumber("1 200,50")).toBe("1200.5");
    expect(readNumber("1.200,50")).toBe("1200.5");
    expect(readNumber("1,200.50")).toBe("1200.5");
    expect(readNumber("1200.5")).toBe("1200.5");
  });

  it("reads a number Excel handed over as a number", () => {
    expect(readNumber(1200.5)).toBe("1200.5");
    expect(readNumber(0)).toBe("0");
  });

  it("treats a lone comma as a decimal point unless it groups three digits", () => {
    expect(readNumber("12,5")).toBe("12.5");
    expect(readNumber("12,500")).toBe("12500");
  });

  it("strips the non-breaking space Excel puts in a thousands separator", () => {
    expect(readNumber("1 200")).toBe("1200");
    expect(readNumber("1 200")).toBe("1200");
  });

  it("returns null for something unreadable rather than a nought it invented", () => {
    expect(readNumber("forfait")).toBeNull();
    expect(readNumber("—")).toBeNull();
    expect(readNumber("")).toBeNull();
    expect(readNumber(null)).toBeNull();
  });
});

const MAPPING: BpuMapping = {
  "N° de prix": "lineNumber",
  Désignation: "designation",
  Unité: "unit",
  Quantité: "quantity",
  "Prix unitaire": "unitPrice",
};

function row(n: number, cells: Record<string, unknown>) {
  return { rowNumber: n, cells };
}

describe("linesFromSheet", () => {
  it("reads the lines and keeps the client's own numbering", () => {
    const read = linesFromSheet(
      [
        row(4, {
          "N° de prix": "1",
          Désignation: "Fourniture et pose de canalisation",
          Unité: "ml",
          Quantité: "1 200",
        }),
        row(5, {
          "N° de prix": "2",
          Désignation: "Coffret de comptage",
          Unité: "U",
          Quantité: "40",
        }),
      ],
      MAPPING,
    );

    expect(read.problems).toEqual([]);
    expect(read.lines).toEqual([
      {
        position: 1,
        reference: null,
        designation: "Fourniture et pose de canalisation",
        unit: "ml",
        qty: "1200",
      },
      { position: 2, reference: null, designation: "Coffret de comptage", unit: "U", qty: "40" },
    ]);
  });

  it("skips a section heading in silence, because forty of them are not forty problems", () => {
    const read = linesFromSheet(
      [
        row(3, { "N° de prix": "", Désignation: "LOT 2 — TERRASSEMENT", Unité: "", Quantité: "" }),
        row(4, {
          "N° de prix": "1",
          Désignation: "Déblai en terrain meuble",
          Unité: "m3",
          Quantité: "800",
        }),
      ],
      MAPPING,
    );

    expect(read.problems).toEqual([]);
    expect(read.lines).toHaveLength(1);
  });

  it("reports a row that has a quantity and no line number", () => {
    const read = linesFromSheet(
      [row(9, { "N° de prix": "", Désignation: "TOTAL GÉNÉRAL", Quantité: "1" })],
      MAPPING,
    );
    expect(read.lines).toEqual([]);
    expect(read.problems).toEqual([{ row: 9, reason: "noLineNumber" }]);
  });

  it("reports an unreadable quantity instead of importing a nought", () => {
    const read = linesFromSheet(
      [row(7, { "N° de prix": "3", Désignation: "Mise à la terre", Quantité: "forfait" })],
      MAPPING,
    );
    expect(read.lines).toEqual([]);
    expect(read.problems).toEqual([{ row: 7, reason: "unreadableQuantity" }]);
  });

  it("reports a repeated line number rather than letting one line overwrite another", () => {
    const read = linesFromSheet(
      [
        row(4, { "N° de prix": "1", Désignation: "Première", Quantité: "1" }),
        row(5, { "N° de prix": "1", Désignation: "Seconde", Quantité: "2" }),
      ],
      MAPPING,
    );
    expect(read.lines).toHaveLength(1);
    expect(read.lines[0]?.designation).toBe("Première");
    expect(read.problems).toEqual([{ row: 5, reason: "duplicateLine" }]);
  });

  it("reports a line with a number and a quantity but nothing said about it", () => {
    const read = linesFromSheet(
      [row(6, { "N° de prix": "12", Désignation: "", Quantité: "4" })],
      MAPPING,
    );
    expect(read.problems).toEqual([{ row: 6, reason: "noDesignation" }]);
  });

  it("returns the lines in the client's order however the sheet was sorted", () => {
    const read = linesFromSheet(
      [
        row(4, { "N° de prix": "12", Désignation: "Douze", Quantité: "1" }),
        row(5, { "N° de prix": "3", Désignation: "Trois", Quantité: "1" }),
      ],
      MAPPING,
    );
    expect(read.lines.map((line) => line.position)).toEqual([3, 12]);
  });
});
