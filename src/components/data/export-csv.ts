import { isValidElement, type ReactNode } from "react";
import type { ColumnDef } from "./types";

/**
 * Screen 79 — Export.
 *
 * The one bulk action that is real work. It writes the rows a person ticked,
 * with the columns the table is actually showing, and nothing else: a file that
 * does not match what is on screen is a file nobody trusts twice.
 *
 * No server round trip and no new dependency. The rows are already in the
 * browser, which is also why it exports the page you are looking at rather than
 * the whole filtered set — the bar only appears once you have ticked rows, so
 * "Export" means "export these", not "export everything I could have ticked".
 */

/**
 * A semicolon, not a comma.
 *
 * Excel in a French locale — which is every machine in the office — splits on
 * `;`. A comma-separated file opens with all seven columns in the first one,
 * and the person who exported it concludes the export is broken.
 */
const SEPARATOR = ";";

/**
 * The text inside a rendered cell.
 *
 * Columns render nodes, not strings: a badge for the stage, a span that goes
 * red inside 48 hours. A CSV wants the words. Walking the node is what keeps
 * the export honest for free — whatever the cell says on screen is what lands
 * in the file, with no second list of formatters to drift out of step.
 */
export function cellText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(cellText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return cellText(node.props.children);
  // A cell drawn entirely as an icon has no words to export. Empty is the
  // honest answer; inventing one would be worse.
  return "";
}

/** Quote only what needs it — a field carrying the separator, a quote or a line break. */
function field(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Header row plus one line per row, in the order the table shows them.
 *
 * `label` is the caller's translator: the header must read in the person's own
 * interface language (LAW 4), and this file is too far from `useTranslations`
 * to ask for it itself.
 */
export function toCsv<Row>(
  rows: Row[],
  columns: ColumnDef<Row>[],
  label: (key: string) => string,
): string {
  const head = columns.map((column) => field(label(column.labelKey)));
  const body = rows.map((row) => columns.map((column) => field(cellText(column.render(row)))));
  return [head, ...body].map((line) => line.join(SEPARATOR)).join("\r\n");
}

/** Hand the file to the browser. Nothing is uploaded and nothing is kept. */
export function downloadCsv(filename: string, csv: string): void {
  // The byte order mark is not decoration: Excel reads a UTF-8 .csv as
  // Windows-1252 without it, and every accented client name arrives mangled.
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
