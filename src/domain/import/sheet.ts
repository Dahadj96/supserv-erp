import ExcelJS from "exceljs";
import { asText, type Cell } from "./clean";

/**
 * Reading the file. Nothing here writes to it — screen 62: "Excel files changed
 * — Never." The workbook is opened from a buffer we already hold, so there is
 * not even a file handle that could truncate the original.
 */

export type Sheet = {
  name: string;
  headers: string[];
  /** Row objects keyed by header, plus the 1-based row number in the file. */
  rows: { rowNumber: number; cells: Record<string, Cell> }[];
};

/** Above this, an import is a background job rather than a page load. */
export const MAX_ROWS = 5_000;

export async function readWorkbook(buffer: ArrayBuffer): Promise<Sheet[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheets: Sheet[] = [];

  workbook.eachSheet((worksheet) => {
    // The header row is the first row with more than one non-empty cell. Real
    // spreadsheets start with a title, a blank line, and then the table.
    let headerRowNumber = 0;
    let headers: string[] = [];

    for (let n = 1; n <= Math.min(worksheet.rowCount, 20); n++) {
      const row = worksheet.getRow(n);
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        values[col - 1] = asText(cell.value) ?? "";
      });
      const filled = values.filter((v) => v.length > 0);
      if (filled.length >= 2) {
        headerRowNumber = n;
        headers = values.map((v, i) => v || `Column ${i + 1}`);
        break;
      }
    }

    if (headerRowNumber === 0) return;

    // Trailing empty columns are an artefact of how Excel stores a sheet, not
    // columns anybody made.
    while (headers.length > 0 && headers[headers.length - 1]?.startsWith("Column ")) {
      headers.pop();
    }

    const rows: Sheet["rows"] = [];
    for (let n = headerRowNumber + 1; n <= worksheet.rowCount; n++) {
      if (rows.length >= MAX_ROWS) break;
      const row = worksheet.getRow(n);
      const cells: Record<string, Cell> = {};
      let anything = false;

      headers.forEach((header, i) => {
        const value = row.getCell(i + 1).value;
        cells[header] = value;
        if (asText(value)) anything = true;
      });

      // A blank line in the middle of a sheet is a separator somebody added,
      // not a record. Skipping it silently is correct; it is not a problem.
      if (anything) rows.push({ rowNumber: n, cells });
    }

    sheets.push({ name: worksheet.name, headers, rows });
  });

  return sheets;
}

/**
 * A CSV that somebody exported from Excel, which is what half of these files
 * really are. Kept deliberately small — papaparse is already a dependency and
 * does the quoting properly, but the shape must match `readWorkbook`.
 */
export function sheetFromRows(name: string, table: string[][]): Sheet[] {
  const [headerRow, ...rest] = table;
  if (!headerRow) return [];

  const headers = headerRow.map((h, i) => h.trim() || `Column ${i + 1}`);
  const rows = rest
    .map((values, index) => {
      const cells: Record<string, Cell> = {};
      headers.forEach((header, i) => {
        cells[header] = values[i] ?? null;
      });
      return { rowNumber: index + 2, cells };
    })
    .filter((r) => Object.values(r.cells).some((c) => asText(c)));

  return [{ name, headers, rows }];
}
