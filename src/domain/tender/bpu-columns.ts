import Decimal from "decimal.js";
import type { BpuLine } from "./bpu";

/**
 * Screen 42, the mapping card — "confirm once, remembered for this client".
 *
 * The same job screen 62's `columns.ts` does for a clients sheet, for the six
 * columns a bordereau has. Kept separate rather than folded into `IMPORTABLE`
 * because a BPU is not a list of records that become rows in a catalogue: the
 * line NUMBER is the identity, the file always belongs to one enquiry, and a
 * sheet with no line numbers is a different problem from a sheet with no email
 * addresses.
 *
 * PURE. Headings in, a proposal out; cells in, lines out.
 *
 * Every synonym below is a heading off a real Algerian bordereau, in French,
 * in Arabic transliteration, or in the mixture people actually type.
 */

export const BPU_TARGETS = [
  "lineNumber",
  "reference",
  "designation",
  "unit",
  "quantity",
  "unitPrice",
  "amount",
] as const;
export type BpuTarget = (typeof BPU_TARGETS)[number];

/** Without these there is no bordereau, only a spreadsheet. */
export const REQUIRED_TARGETS: BpuTarget[] = ["lineNumber", "designation", "quantity"];

const SYNONYMS: Record<BpuTarget, string[]> = {
  lineNumber: [
    "n de prix",
    "no de prix",
    "num de prix",
    "numero de prix",
    "n prix",
    "n",
    "no",
    "num",
    "numero",
    "item",
    "line",
    "line number",
    "rang",
    "ordre",
    "n d ordre",
  ],
  reference: ["reference", "ref", "code", "code article", "article", "cle", "repere", "repère"],
  designation: [
    "designation",
    "désignation",
    "designation des travaux",
    "designation des prestations",
    "libelle",
    "libellé",
    "description",
    "nature des travaux",
    "nature",
    "intitule",
    "intitulé",
    "prestation",
  ],
  unit: ["unite", "unité", "u", "um", "unit", "unite de mesure", "mesure"],
  quantity: ["quantite", "quantité", "qte", "qté", "qty", "quantity", "nombre", "nbre"],
  unitPrice: [
    "prix unitaire",
    "prix unitaire hors taxes",
    "prix unitaire ht",
    "pu",
    "pu ht",
    "unit price",
    "prix",
  ],
  amount: ["montant", "montant ht", "montant total", "total", "amount", "prix total"],
};

/** Accents, punctuation and doubled spaces off, so `N° de prix` meets `n de prix`. */
export function normaliseHeading(heading: string): string {
  return heading
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type BpuMapping = Record<string, BpuTarget | null>;

/**
 * What each heading probably is.
 *
 * PROPOSED, not applied. A target is claimed by the FIRST heading that matches
 * it, so a sheet carrying both `Prix unitaire` and `PU` does not map two
 * columns onto one field and silently keep whichever the loop saw last.
 */
export function proposeBpuMapping(headings: string[]): BpuMapping {
  const mapping: BpuMapping = {};
  const taken = new Set<BpuTarget>();

  for (const heading of headings) {
    const normalised = normaliseHeading(heading);
    let hit: BpuTarget | null = null;

    for (const target of BPU_TARGETS) {
      if (taken.has(target)) continue;
      if (SYNONYMS[target].includes(normalised)) {
        hit = target;
        break;
      }
    }

    if (hit) taken.add(hit);
    mapping[heading] = hit;
  }

  return mapping;
}

export function missingTargets(mapping: BpuMapping): BpuTarget[] {
  const present = new Set(Object.values(mapping).filter((t): t is BpuTarget => t !== null));
  return REQUIRED_TARGETS.filter((target) => !present.has(target));
}

/**
 * A number as an Algerian spreadsheet writes it.
 *
 * `1 200,50`, `1.200,50`, `1,200.50` and `1200.5` are all the same quantity and
 * all four turn up in the same folder. Returning null rather than guessing at
 * something unreadable is deliberate: an unreadable quantity is a problem the
 * screen reports, not a nought it invents.
 */
export function readNumber(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;

  let text = String(raw).trim();
  if (!text) return null;

  // Non-breaking and thin spaces are what Excel puts in a thousands separator.
  text = text.replace(/[\s  ']/g, "");

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever comes last is the decimal separator; the other groups thousands.
    const decimal = lastComma > lastDot ? "," : ".";
    const grouping = decimal === "," ? "." : ",";
    text = text.split(grouping).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    // A lone comma is a decimal separator unless it groups three digits.
    text = /,\d{3}(\D|$)/.test(text) ? text.split(",").join("") : text.replace(",", ".");
  }

  if (!/^-?\d*\.?\d+$/.test(text)) return null;
  try {
    return new Decimal(text).toString();
  } catch {
    return null;
  }
}

export type ReadRow = { rowNumber: number; cells: Record<string, unknown> };

export type BpuRead = {
  lines: BpuLine[];
  /**
   * Rows that could not be read, with the row number as it is in the file.
   *
   * Screen 62: "Problems found — handled, not hidden." A bordereau has a
   * section heading every eight lines and a `TOTAL` at the bottom, and those
   * are not lines. They are reported, not imported, and not called errors.
   */
  problems: { row: number; reason: string }[];
};

const PROBLEMS = ["noLineNumber", "noDesignation", "unreadableQuantity", "duplicateLine"] as const;
export type BpuProblem = (typeof PROBLEMS)[number];

/**
 * The rows of the sheet as bordereau lines.
 *
 * A row with no line number and no quantity is a section heading — `LOT 2 —
 * TERRASSEMENT` — and is skipped in silence, because reporting forty section
 * headings as problems buries the one row that actually failed.
 */
export function linesFromSheet(rows: ReadRow[], mapping: BpuMapping): BpuRead {
  const columnFor = (target: BpuTarget): string | null =>
    Object.keys(mapping).find((heading) => mapping[heading] === target) ?? null;

  const cols = {
    lineNumber: columnFor("lineNumber"),
    reference: columnFor("reference"),
    designation: columnFor("designation"),
    unit: columnFor("unit"),
    quantity: columnFor("quantity"),
  };

  const lines: BpuLine[] = [];
  const problems: BpuRead["problems"] = [];
  const seen = new Set<number>();

  const text = (row: ReadRow, column: string | null): string | null => {
    if (!column) return null;
    const value = row.cells[column];
    if (value === null || value === undefined) return null;
    const asText = String(
      typeof value === "object" ? ((value as { text?: string }).text ?? "") : value,
    ).trim();
    return asText || null;
  };

  for (const row of rows) {
    const number = readNumber(text(row, cols.lineNumber));
    const designation = text(row, cols.designation);
    const rawQty = text(row, cols.quantity);

    // A heading row, or the total. Neither is a line and neither is a problem.
    if (number === null && rawQty === null) continue;

    if (number === null) {
      problems.push({ row: row.rowNumber, reason: "noLineNumber" });
      continue;
    }
    const position = Math.trunc(Number(number));
    if (!Number.isSafeInteger(position) || position < 1) {
      problems.push({ row: row.rowNumber, reason: "noLineNumber" });
      continue;
    }
    if (seen.has(position)) {
      problems.push({ row: row.rowNumber, reason: "duplicateLine" });
      continue;
    }
    if (!designation) {
      problems.push({ row: row.rowNumber, reason: "noDesignation" });
      continue;
    }

    const qty = readNumber(rawQty);
    if (qty === null) {
      problems.push({ row: row.rowNumber, reason: "unreadableQuantity" });
      continue;
    }

    seen.add(position);
    lines.push({
      position,
      reference: text(row, cols.reference),
      designation,
      unit: text(row, cols.unit),
      qty,
    });
  }

  lines.sort((a, b) => a.position - b.position);
  return { lines, problems };
}
