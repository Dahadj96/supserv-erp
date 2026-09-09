import { Workbook } from "exceljs";
import { ArchiveRefused, readZip } from "@/capture/archive/zip";
import { repairArabic } from "./arabic";
import type { PageText, TextLayer } from "./text-layer";

/**
 * Word and Excel, read as text.
 *
 * Not OCR and not a PDF text layer: both formats simply CONTAIN their text, and
 * until this file existed `extractText()` threw for them. A supplier's price
 * list arrives as .xlsx more often than as anything else, and an Algerian CCTP
 * is very often a .docx — so "no preview yet" on screen 40 was covering the two
 * commonest documents in the mailbox after the PDF.
 *
 * Both produce the SAME `TextLayer` the PDF path produces, so `intake_page`,
 * `proposeFields`, the review screen and citations are all unchanged. That is
 * the whole design: one shape, three readers.
 */

/** What each format calls itself, and what a mail client calls it. */
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type OfficeKind = "docx" | "xlsx";

/**
 * Which reader a file needs, or null when it is neither.
 *
 * The extension is checked as well as the declared type, because the declared
 * type on a mail attachment is whoever sent it (`src/domain/files/serving.ts`)
 * and half of them arrive as `application/octet-stream`. Guessing wrong here
 * costs an error message, not a security decision — `readZip` refuses anything
 * that is not really a zip, and neither reader writes anywhere.
 */
export function officeKind(filename: string, mime: string | null): OfficeKind | null {
  const name = filename.toLowerCase();
  const type = (mime ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

  if (name.endsWith(".docx") || type === DOCX_MIME) return "docx";
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm") || type === XLSX_MIME) return "xlsx";
  return null;
}

/** Both formats are zips, so both can be refused the same way. */
export class NotReadable extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "NotReadable";
  }
}

/** The caps a spreadsheet is read under. A workbook can be enormous by accident. */
export const SHEET_LIMITS = { rows: 5_000, columns: 200 } as const;

/**
 * A .docx.
 *
 * The format is a zip of XML. `word/document.xml` is the body; headers and
 * footers are separate parts and are NOT read — on an Algerian administrative
 * document they hold the letterhead and a page number, which would be repeated
 * on every page and would drown the extraction in noise.
 *
 * PAGES ARE THE HONEST PROBLEM HERE. A .docx has no pages: pagination happens
 * when something renders it, and the file does not know how tall a page is.
 * What it does record is where the AUTHOR forced a break — `<w:br w:type="page"/>`
 * — and that is what is split on. A document with no forced breaks comes back
 * as one page, and a citation on screen 40 says "page 1" for the whole file,
 * which is true rather than convenient.
 *
 * Word also leaves `<w:lastRenderedPageBreak/>` behind, a cache of where IT
 * last paginated. It is deliberately not used: it is absent in files written by
 * anything else, and stale in a file edited since, so a citation built on it
 * would point at a page the reader does not have.
 */
export async function readDocx(file: Buffer): Promise<TextLayer> {
  const parts = await open(file, (path) => path === "word/document.xml");
  const body = parts.get("word/document.xml");
  if (!body) throw new NotReadable("noDocumentPart");

  const xml = body.toString("utf8");
  const texts = splitPages(xml).map(paragraphs);

  return layerOf(texts.filter((text, i) => text.length > 0 || i === 0));
}

/**
 * A .xlsx, one page per worksheet.
 *
 * A sheet is the honest unit: it is what a person means by "the second tab",
 * it is what a citation can point at, and a bordereau des prix is one sheet
 * whether it prints on one page or nine. The sheet's name is the first line of
 * its page, so a citation reads as something a person can find.
 *
 * `exceljs` was already a dependency (STACK.md: use this, not `xlsx`).
 */
export async function readXlsx(file: Buffer): Promise<TextLayer> {
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(file as unknown as ArrayBuffer);
  } catch (error) {
    throw new NotReadable(error instanceof Error ? error.message : "unreadableWorkbook");
  }

  const texts: string[] = [];

  for (const sheet of workbook.worksheets) {
    const lines: string[] = [sheet.name];
    let rows = 0;

    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (rows >= SHEET_LIMITS.rows) return;
      rows++;

      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        if (column > SHEET_LIMITS.columns) return;
        cells.push(cellText(cell.value));
      });

      // A row of empty cells is a spacer somebody left in the layout, not a
      // line of the document.
      const line = cells.join("\t").trimEnd();
      if (line.trim()) lines.push(line);
    });

    texts.push(lines.join("\n"));
  }

  if (texts.length === 0) throw new NotReadable("noSheets");
  return layerOf(texts);
}

/**
 * One cell as the text a person would see.
 *
 * A formula cell carries both the formula and its last computed result; the
 * RESULT is what the document says. A formula with no cached result — a file
 * written by something that does not compute — has nothing to read, and an
 * empty string is the truthful answer rather than `=SUM(B2:B14)`.
 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  const record = value as Record<string, unknown>;
  if ("result" in record) return cellText(record.result);
  if ("text" in record) return cellText(record.text);
  if ("hyperlink" in record) return cellText(record.text ?? record.hyperlink);
  // Rich text: an array of runs, each with its own formatting.
  if (Array.isArray(record.richText)) {
    return (record.richText as { text?: string }[]).map((run) => run.text ?? "").join("");
  }
  if ("error" in record) return "";
  return "";
}

/** Pull the parts wanted out of an OOXML file, refusing anything that is not one. */
async function open(file: Buffer, want: (path: string) => boolean): Promise<Map<string, Buffer>> {
  let reading: Awaited<ReturnType<typeof readZip>>;
  try {
    reading = await readZip(file, want);
  } catch (error) {
    // `notAZip` here means the file is not the format its name claims — a .doc
    // renamed, a download that stopped halfway. The same guards that protect
    // the mailbox from a hostile archive protect it from this.
    throw new NotReadable(error instanceof ArchiveRefused ? error.detail : "unreadable");
  }

  return new Map(reading.entries.map((entry) => [entry.path, entry.bytes]));
}

/**
 * Split the body on the breaks the author forced, and nothing else.
 *
 * Done on the raw XML rather than on extracted text because a page break is
 * markup: by the time the tags are gone there is nothing left to split on that
 * is not a guess about how tall a page is.
 */
function splitPages(xml: string): string[] {
  const body = xml.slice(xml.indexOf("<w:body"));
  return body.split(/<w:br[^>]*w:type="page"[^>]*\/?>/);
}

/**
 * The text of one run of paragraphs.
 *
 * `<w:p>` is a paragraph, `<w:t>` the text inside it, `<w:tab/>` a tab and
 * `<w:br/>` a line break. A table cell is a paragraph like any other, so a
 * bordereau written in Word comes out row by row — which is the point: it is
 * the same shape the PDF path gives, and `proposeFields` reads both.
 */
function paragraphs(xml: string): string {
  // Walked token by token rather than stripped, because ONLY `<w:t>` holds text
  // a person typed. Everything else in the part is formatting, revision history
  // and the identifiers Word keeps for itself — a blanket tag strip pulls all of
  // that into the document and the extraction reads it as content.
  const token = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*>|<w:br\b[^>]*>|<\/w:(p|tc|tr)>/g;

  let out = "";
  for (const match of xml.matchAll(token)) {
    const [whole, text, closing] = match;
    if (text !== undefined) out += text;
    else if (whole.startsWith("<w:tab")) out += "\t";
    else if (whole.startsWith("<w:br")) out += "\n";
    else if (closing === "tc")
      out += "\t"; // a cell ends a column
    else out += "\n"; // a paragraph, and a table row, end a line
  }

  return (
    decodeXml(out)
      // A paragraph inside a table cell ends a line that the cell then turns
      // back into a column: `a\n\tb` is one row, not two.
      .replace(/\n+\t/g, "\t")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

/**
 * The same `TextLayer` the PDF path returns, so nothing downstream can tell
 * which reader produced it.
 *
 * `thinPages` is empty by construction and that is not an oversight: a thin
 * page in a PDF means "this page is a picture and needs OCR". A Word file has
 * no pictures of text to fall back from — a page with nothing on it has
 * nothing on it, and sending it to an OCR container that does not exist would
 * be inventing a reason to fail.
 */
function layerOf(texts: string[]): TextLayer {
  let repairedAny = false;
  let stillBroken = false;

  const pages: PageText[] = texts.map((raw, i) => {
    // Arabic in an OOXML part is stored in logical order, unlike a PDF — so
    // this usually changes nothing. It is run anyway because a .docx made by
    // converting a PDF carries the PDF's presentation forms straight through,
    // and that file is unsearchable in exactly the way docs/OCR.md §4 describes.
    const repair = repairArabic(raw);
    if (repair.repaired) repairedAny = true;
    if (repair.stillBroken) stillBroken = true;

    return {
      page: i + 1,
      text: repair.text,
      lines: repair.text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    };
  });

  return {
    pages,
    totalPages: pages.length,
    thinPages: [],
    arabicRepaired: repairedAny,
    needsBidi: stillBroken,
  };
}
