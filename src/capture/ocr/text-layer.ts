import { getDocumentProxy, extractText as unpdfExtractText } from "unpdf";
import { repairArabic } from "./arabic";
import { needsBidiRepair, type OcrBlock, type OcrResult } from "./provider";

/**
 * Step 1 of the order in `provider.ts`: the PDF's own text layer.
 *
 * docs/OCR.md measured this at 0.055s and perfect on a digital bordereau —
 * fifty times faster and more accurate than OCR. Most tender PDFs and every
 * supplier quote produced by a computer are digital, so this answers most of
 * the time, on the office machine, for nothing.
 */

/**
 * Below this many characters per page, the "text layer" is a scanner's
 * decoration — a page number, a stamp — rather than the document. Measured
 * against real dossiers: a genuine page of a règlement de consultation runs to
 * well over a thousand characters; a scanned page yields under fifty.
 */
const THIN_PAGE = 120;

export type PageText = {
  page: number;
  text: string;
  /** Lines, in reading order. What a citation points at. */
  lines: string[];
};

export type TextLayer = {
  pages: PageText[];
  totalPages: number;
  /** Pages whose text layer is too thin to be the document. These need OCR. */
  thinPages: number[];
  /** True when Arabic on this document was reversed and has been put right. */
  arabicRepaired: boolean;
  /**
   * True when Arabic is STILL in presentation forms after the repair, which
   * means this text layer cannot be searched and the page belongs in OCR.
   * See provider.ts and docs/OCR.md §4.
   */
  needsBidi: boolean;
};

export async function readTextLayer(file: Buffer): Promise<TextLayer> {
  const bytes = new Uint8Array(file);
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await unpdfExtractText(pdf, { mergePages: false });

  let repairedAny = false;
  let stillBroken = false;

  const pages: PageText[] = (text as string[]).map((raw, i) => {
    // Arabic comes out of a PDF as reversed presentation glyphs. Repaired here,
    // once, before anything else in the system ever sees it — because every
    // consumer downstream (search, extraction, a citation on screen 40) needs
    // the letters a person would type, not the glyphs a typesetter chose.
    // docs/OCR.md §4.
    const repair = repairArabic(normalise(raw));
    if (repair.repaired) repairedAny = true;
    if (repair.stillBroken) stillBroken = true;

    const cleaned = repair.text;
    return {
      page: i + 1,
      text: cleaned,
      lines: cleaned
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    };
  });

  return {
    pages,
    totalPages,
    thinPages: pages.filter((p) => p.text.length < THIN_PAGE).map((p) => p.page),
    arabicRepaired: repairedAny,
    // Only true when the repair FAILED. A page still holding presentation forms
    // cannot be trusted or searched, and Tesseract reads printed Arabic well —
    // so that page belongs in OCR. A page that repaired cleanly does not.
    needsBidi: stillBroken || pages.some((p) => needsBidiRepair(p.text)),
  };
}

/**
 * pdf.js hands text back as positioned fragments, so a single sentence arrives
 * split across items and a paragraph arrives as one long line. Neither is what
 * a person sees, and a citation that quotes a fragment is worse than none.
 *
 * Soft hyphens and the hyphen-at-end-of-line convention are joined back up,
 * because "sep-\ntembre" must be findable as "septembre".
 */
function normalise(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/­/g, "")
    .replace(/(\p{Ll})-\n(\p{Ll})/gu, "$1$2")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Every page has real text on it. Nothing needs OCR. */
export function isFullyDigital(layer: TextLayer): boolean {
  return layer.pages.length > 0 && layer.thinPages.length === 0;
}

/**
 * Turn the text layer into the shape the rest of the system speaks.
 *
 * Confidence is 1 — not optimism, a statement of fact. This text was not read
 * off an image, it is what the file says. Whether the EXTRACTION from it is
 * right is a separate question, and screen 40 is where that one is answered.
 */
export function toOcrResult(layer: TextLayer): OcrResult {
  const blocks: OcrBlock[] = layer.pages.flatMap((p) =>
    p.lines.map(
      (line): OcrBlock => ({
        text: line,
        page: p.page,
        // No bounding box: pdf.js gives positions per fragment, and a box drawn
        // around a fragment points at half a word. Screen 40 cites page and
        // quotation, which is what a person actually checks against. Boxes
        // arrive with the OCR path, where they are per-line and meaningful.
        confidence: 1,
      }),
    ),
  );

  return {
    text: layer.pages.map((p) => p.text).join("\n\n"),
    blocks,
    tables: [],
    pages: layer.totalPages,
    confidence: 1,
    provider: "text-layer",
    detectedLocale: guessLocale(layer),
  };
}

/**
 * LAW 4 — a document follows its counterparty, and the first thing to know
 * about a dossier is which language it is written in.
 */
function guessLocale(layer: TextLayer): string | undefined {
  const sample = layer.pages
    .slice(0, 3)
    .map((p) => p.text)
    .join(" ")
    .toLowerCase();
  if (!sample) return undefined;

  if (/[؀-ۿ]/.test(sample)) return "ar";
  // Words that appear in every French administrative document and in no
  // English one. Cheap, and right far more often than a character histogram.
  const french = /\b(le|la|les|des|du|aux|selon|conformément|article|marché|offre)\b/g;
  const english = /\b(the|of|shall|tender|offer|article|pursuant)\b/g;
  const fr = (sample.match(french) ?? []).length;
  const en = (sample.match(english) ?? []).length;
  if (fr === 0 && en === 0) return undefined;
  return fr >= en ? "fr" : "en";
}
