/**
 * Screen 62 — "Problems found · handled, not hidden".
 *
 * Six problems are named on that screen and every one of them is a real thing
 * that happens to a spreadsheet somebody has been keeping for four years:
 *
 *   Dates in two formats      → normalised
 *   Amounts as text           → converted
 *   Missing NIF               → imported blank
 *   Rows with no client name  → skipped
 *   Duplicate companies       → merged (suggested, on screen 84)
 *   CVs that will not open    → listed after import
 *
 * The word that matters is HANDLED. Not one of them stops the import, and not
 * one of them is silent. A file that refuses to load until it is perfect is a
 * file that never gets loaded.
 */

export type ProblemKey =
  | "noName"
  | "dateFormats"
  | "amountsAsText"
  | "missingNif"
  | "duplicates"
  | "badNif"
  | "unreadableRows";

export type Problems = Partial<Record<ProblemKey, number>>;

export function bump(problems: Problems, key: ProblemKey, by = 1) {
  problems[key] = (problems[key] ?? 0) + by;
}

/** A cell as exceljs hands it over: a string, a number, a date, or a formula. */
export type Cell = unknown;

export function asText(cell: Cell): string | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "string") return cell.trim() || null;
  if (typeof cell === "number") return String(cell);
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  if (typeof cell === "object") {
    // exceljs returns { text, hyperlink } for links and { result } for formulas.
    const o = cell as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(o.richText))
      return (
        o.richText
          .map((r) => r.text)
          .join("")
          .trim() || null
      );
    if (typeof o.text === "string") return o.text.trim() || null;
    if (o.result !== undefined) return asText(o.result);
  }
  return String(cell).trim() || null;
}

/**
 * "Dates in two formats — normalised."
 *
 * A single sheet routinely holds 12/03/2026, 2026-03-12 and an Excel serial
 * number, because three people maintained it. Day-first is assumed for the
 * ambiguous ones: this is an Algerian office, 03/12 is the third of December.
 */
export function asDate(cell: Cell): Date | null {
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? null : cell;

  if (typeof cell === "number") {
    // Excel's epoch, with the 1900 leap-year bug it has never fixed.
    if (cell < 1 || cell > 2_958_465) return null;
    return new Date(Date.UTC(1899, 11, 30) + cell * 86_400_000);
  }

  const text = asText(cell);
  if (!text) return null;

  const dmy = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = Number(y) < 100 ? 2000 + Number(y) : Number(y);
    const date = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

/**
 * "Amounts as text — converted."
 *
 * "1 250 000,00 DA" and "1,250,000.00" and "45 000" are all numbers somebody
 * typed. The separator is decided by which of `,` and `.` comes last.
 */
export function asAmount(cell: Cell): number | null {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;

  const text = asText(cell);
  if (!text) return null;

  const stripped = text.replace(/[^\d.,-]/g, "");
  if (!stripped || !/\d/.test(stripped)) return null;

  const lastComma = stripped.lastIndexOf(",");
  const lastDot = stripped.lastIndexOf(".");

  let normalised: string;
  if (lastComma > lastDot) {
    normalised = stripped.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    normalised = stripped.replace(/,/g, "");
  } else {
    normalised = stripped.replace(/[.,]/g, "");
  }

  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

/**
 * "Missing NIF — 19, imported blank."
 *
 * A NIF is fifteen digits (décret 05-468). Anything else is kept out of the
 * field rather than stored wrong — an invoice cannot be issued without a valid
 * one, and a wrong NIF passes that check while failing at the tax office.
 */
export function asNif(cell: Cell): { value: string | null; wasPresent: boolean; valid: boolean } {
  const text = asText(cell);
  if (!text) return { value: null, wasPresent: false, valid: false };

  const digits = text.replace(/\D/g, "");
  if (digits.length === 15) return { value: digits, wasPresent: true, valid: true };
  return { value: null, wasPresent: true, valid: false };
}

/** Spreadsheet phone numbers arrive as 0X XX XX XX XX, +213…, or a number. */
export function asPhone(cell: Cell): string | null {
  const text = asText(cell);
  if (!text) return null;
  const cleaned = text.replace(/[^\d+]/g, "");
  if (cleaned.replace(/\D/g, "").length < 6) return null;
  return text.trim();
}

export function asEmail(cell: Cell): string | null {
  const text = asText(cell);
  if (!text) return null;
  const found = text.match(/[^\s,;<>()]+@[^\s,;<>()]+\.[a-z]{2,}/i);
  return found ? found[0].toLowerCase() : null;
}

/** fr | en, from whatever somebody typed in a Langue column. */
export function asLocale(cell: Cell): "fr" | "en" | null {
  const text = asText(cell)?.toLowerCase();
  if (!text) return null;
  if (/^(fr|fra|français|francais|french)/.test(text)) return "fr";
  if (/^(en|eng|anglais|english)/.test(text)) return "en";
  return null;
}
