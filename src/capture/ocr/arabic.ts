/**
 * The Arabic repair from docs/OCR.md §4, in code.
 *
 * A PDF does not store Arabic the way a person types it. It stores the GLYPHS
 * in the order they appear on the page — left to right — and each glyph is the
 * contextual form the typesetter chose: initial, medial, final or isolated.
 * Pull that out naively and you get this:
 *
 *     ﺔﻴﺒﻌﺸﻟا ﺔﻴﻃاﺮﻘﻤﻳﺪﻟا ﺔﻳﺮﺋاﺰﺠﻟا ﺔﻳرﻮﻬﻤﺠﻟا
 *
 * which is unreadable and, worse, UNSEARCHABLE: somebody typing الجزائرية finds
 * nothing, because the letters in the stored text are different codepoints in
 * the opposite order.
 *
 * Two operations fix it, and both were measured on a real tender notice:
 *
 *   1. NFKC normalisation folds every presentation form back to its base letter
 *      (ﺟ U+FEDF → ج U+062C) and splits the lam-alef ligature into its two.
 *   2. Reversing the visual order gives logical order — with the exception of
 *      any Latin or numeric run, which the typesetter already laid out left to
 *      right and which must be reversed back or `25/DA/2026` becomes
 *      `6202/AD/52`.
 *
 * `python-bidi` does the general case of step 2. This is the narrow case that
 * actually occurs: a line of Arabic with occasional numbers and references in
 * it. Anything it cannot repair still reports itself as broken, and the caller
 * sends the page to OCR — which reads printed Arabic well.
 */

/** Arabic Presentation Forms A (U+FB50–FDFF) and B (U+FE70–FEFF). */
const PRESENTATION_FORMS = /[ﭐ-﷿ﹰ-﻿]/;

/** Arabic proper, once the presentation forms have been folded away. */
const ARABIC_BASE = /[؀-ۿݐ-ݿ]/;

/**
 * A run the typesetter laid out left to right and which must survive reversal:
 * a reference, a date, a quantity, a unit.
 *
 * Interior punctuation AND interior spaces are part of the run. The spaces are
 * not an afterthought — `1,5 mm` is two alphanumeric pieces with a space
 * between them, and reversing them separately gives `mm 1,5`, which is how the
 * first version of this file failed its own test. Real bidi treats a sequence
 * of left-to-right pieces joined by neutrals as ONE embedding; so does this.
 */
const LTR_RUN = /[A-Za-z0-9](?:[A-Za-z0-9./,:%°\- ]*[A-Za-z0-9%°])?/g;

/** True when this text came out of a PDF as presentation glyphs. */
export function isPresentationForm(text: string): boolean {
  return PRESENTATION_FORMS.test(text);
}

export function hasArabic(text: string): boolean {
  return ARABIC_BASE.test(text) || PRESENTATION_FORMS.test(text);
}

function reverseKeepingLtrRuns(line: string): string {
  const reversed = [...line].reverse().join("");
  // After reversing the whole line every Latin/numeric run is backwards. Turning
  // each one around again is what `get_display` does with an LTR embedding.
  return reversed.replace(LTR_RUN, (run) => [...run].reverse().join(""));
}

export type Repair = {
  text: string;
  /** True when something was actually changed. */
  repaired: boolean;
  /**
   * True when presentation forms survived the repair, which means the text
   * layer cannot be trusted and the page belongs in OCR. docs/OCR.md: Tesseract
   * reads printed Arabic well, so this is not a dead end.
   */
  stillBroken: boolean;
};

/**
 * Repair one block of text taken from a PDF text layer.
 *
 * Lines with no Arabic in them are returned untouched — a French bordereau must
 * not be reversed on its way through here, and this function is called on every
 * page because a tender dossier mixes the two languages page by page.
 */
export function repairArabic(text: string): Repair {
  if (!isPresentationForm(text)) {
    return { text, repaired: false, stillBroken: false };
  }

  const lines = text.split(/\r?\n/).map((line) => {
    if (!isPresentationForm(line)) return line;
    // NFKC first: reversing presentation forms would only give reversed
    // presentation forms, and the search problem would remain.
    return reverseKeepingLtrRuns(line.normalize("NFKC"));
  });

  const repaired = lines.join("\n");

  return {
    text: repaired,
    repaired: true,
    stillBroken: isPresentationForm(repaired),
  };
}
