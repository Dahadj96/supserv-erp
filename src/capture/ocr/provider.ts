/**
 * OCR WITHOUT A SECOND BILL.  See docs/OCR.md — every number there was measured,
 * not guessed.
 *
 * Azure Document Intelligence was removed from the plan: SUPSERV pays for the VPS
 * and nothing else. Microsoft 365's own OCR needs a Syntex licence, so it is out
 * too. Everything here runs on the VPS, free, and no client document leaves the
 * server — which matters more for a tender dossier than the money does.
 *
 * THE ORDER MATTERS AND IS NOT NEGOTIABLE:
 *
 *   1. text-layer   pdfplumber. 0.055s and PERFECT on a digital bordereau —
 *                   fifty times faster and more accurate than OCR. Most tender
 *                   PDFs are digital, so this answers most of the time.
 *   2. ocr          OCRmyPDF + Tesseract 5. Scans only. ~2.7s/page, all cores.
 *   3. rapid        RapidOCR (ONNX PaddleOCR) on CPU. Only when 2 reads badly.
 *   4. azure        Left empty on purpose. If a scanned bordereau ever costs an
 *                   hour a week, this is one file and an API key.
 */
export type OcrBlock = {
  text: string;
  page: number;
  /** Kept so extraction review can cite the exact place. Screen 40, LAW 2. */
  boundingBox?: [number, number, number, number];
  confidence: number;
};

export type ExtractedTable = {
  page: number;
  rows: string[][];
  /** text-layer tables are trustworthy; ocr tables always need a human. */
  trustworthy: boolean;
};

export type OcrResult = {
  text: string;
  blocks: OcrBlock[];
  tables: ExtractedTable[];
  pages: number;
  confidence: number;
  provider: "text-layer" | "ocr" | "rapid" | "azure";
  detectedLocale?: string;
};

export interface OcrProvider {
  name: OcrResult["provider"];
  extract(file: Buffer, mime: string): Promise<OcrResult>;
}

/** Below this, every field must be confirmed by a person before it is fact. */
export const REVIEW_THRESHOLD = 0.8;

/**
 * TESSERACT PAGE SEGMENTATION — the single setting that decides whether a
 * bordereau des prix survives.
 *
 *   --psm 6  "assume a uniform block of text"  ->  DESTROYS TABLES.
 *            Measured: row 4 vanished, quantity and unit columns lost,
 *            the header came out as "Prcuniaire#T | Momtanenr".
 *   --psm 3  "fully automatic page segmentation" -> all five rows, every
 *            price and quantity correct.
 *
 * Every tutorial online uses --psm 6. Do not copy them.
 */
export const TESSERACT_ARGS = ["--psm", "3", "-l", "fra+ara+eng"] as const;

/**
 * ARABIC INVERTS THE RULE ABOVE, and this is the part that would otherwise cost
 * days to discover.
 *
 * A PDF stores Arabic as visual-order presentation glyphs. Extracted naively you
 * get reversed, isolated letterforms that no user can search:
 *
 *     ﺔﻴﺒﻌﺸﻟا ﺔﻴﻃاﺮﻘﻤﻳﺪﻟا ﺔﻳﺮﺋاﺰﺠﻟا ﺔﻳرﻮﻬﻤﺠﻟا
 *
 * bidi reordering + NFKC normalisation repairs it, tested:
 *
 *     الجمهورية الجزائرية الديمقراطية الشعبية
 *
 * and `"الجزائرية" in text` becomes true — i.e. it is findable by someone typing
 * normally. Run this on ANY Arabic text taken from a PDF text layer.
 *
 * Meanwhile Tesseract reads printed Arabic well (3 of 4 lines perfect on a real
 * tender notice), so for Arabic scans, prefer OCR over a suspicious text layer.
 */
export function needsBidiRepair(text: string): boolean {
  // Arabic Presentation Forms A (FB50–FDFF) and B (FE70–FEFF)
  return /[ﭐ-﷿ﹰ-﻿]/.test(text);
}

export async function extractText(_file: Buffer, _mime: string): Promise<OcrResult> {
  // 1. always try the text layer first — free, instant, usually better
  // 2. if it is thin, or Arabic and still in presentation forms, run OCR
  // 3. if OCR confidence < REVIEW_THRESHOLD, escalate to RapidOCR
  // 4. anything below threshold goes to extraction review regardless. LAW 2.
  throw new Error("implement in phase 2: see docs/OCR.md");
}
