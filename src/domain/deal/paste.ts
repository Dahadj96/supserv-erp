/**
 * Screen 06 — turning what the client actually sent into lines.
 *
 * Phase 4 is done when "an RFQ with items pasted from an email body reaches a
 * sent offer". The pasting is this file, and it is worth doing properly because
 * the alternative is somebody retyping fourteen lines of valve references at
 * five o'clock, which is where wrong quantities come from.
 *
 * Two shapes arrive, and they need different readers:
 *
 *   1. TABS — pasted out of Excel or a Word table. The columns are already
 *      separated and the only question is which column is which.
 *   2. PROSE — typed into the body of an email. `1. VP-DN80-16 Vanne papillon
 *      DN80 PN16 — 12 pc`, or a dash list, or a bare list of designations.
 *
 * Everything here PROPOSES. Nothing is written until a person looks at the
 * table and presses the button — LAW 2, and the same shape as screen 40.
 */

export type ParsedLine = {
  position: number;
  /** The client's own string. Never our item code. */
  reference: string | null;
  designation: string;
  qty: string;
  unit: string | null;
  /** How it was read, so a person can see which rows to look at hardest. */
  readAs: "tabs" | "numbered" | "dashed" | "bare";
  /** True when the quantity was not in the text and 1 was assumed. */
  qtyAssumed: boolean;
};

export type Paste = {
  lines: ParsedLine[];
  /** Lines that produced nothing. Shown to the person, never silently dropped. */
  ignored: string[];
  shape: "tabs" | "prose" | "empty";
};

/**
 * Units this office actually writes. Matched case-insensitively, accents
 * stripped, and only at the END of a line next to a number — `pc` inside
 * "pcs de rechange" is not a unit.
 */
const UNITS = [
  "pc",
  "pcs",
  "piece",
  "pieces",
  "u",
  "unite",
  "unites",
  "lot",
  "lots",
  "ml",
  "m",
  "m2",
  "m3",
  "kg",
  "g",
  "t",
  "l",
  "boite",
  "boites",
  "paire",
  "paires",
  "jeu",
  "jeux",
  "ens",
  "rouleau",
  "rouleaux",
  "sac",
  "sacs",
];

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Whether a token is a unit word, ignoring case and accents. */
export function isUnit(token: string): boolean {
  return UNITS.includes(stripAccents(token.toLowerCase()).replace(/\.$/, ""));
}

/**
 * A reference, as clients write them: `VP-DN80-16`, `RAC-BR-2`, `JT-EPDM-80`,
 * `3000116322`.
 *
 * At least one digit and one of `-`, `/` or `.`, OR six or more digits on their
 * own. The point of the punctuation requirement is that `Vanne` and `DN80` are
 * not references — `DN80` is part of the designation, and treating it as a
 * reference would put a size in the reference column of every offer.
 */
const REFERENCE = /^(?=.*\d)[A-Z0-9]+(?:[-/.][A-Z0-9]+)+$|^\d{6,}$/i;

export function looksLikeReference(token: string): boolean {
  return REFERENCE.test(token.trim());
}

/**
 * A quantity: `12`, `1 000`, `2,5`, `2.5`.
 *
 * Returned as a plain decimal string because that is what the numeric column
 * wants, and because a quantity that has been through `Number` and back has
 * already lost `1 000,001` on some machine somewhere.
 */
export function readQty(raw: string): string | null {
  const cleaned = raw.replace(/[\s ]/g, "");
  if (!/^\d[\d.,]*$/.test(cleaned)) return null;
  // A comma or dot with one to three digits after it is a decimal separator;
  // anything else is thousands grouping. `1.000` is a thousand, `2.5` is two
  // and a half, and both are written by the same people in the same week.
  const m = cleaned.match(/^(.*)[.,](\d{1,3})$/);
  if (m && !/^\d{3}$/.test(m[2] ?? "")) {
    const whole = (m[1] ?? "").replace(/[.,]/g, "");
    return whole ? `${whole}.${m[2]}` : null;
  }
  const whole = cleaned.replace(/[.,]/g, "");
  return /^\d+$/.test(whole) ? whole : null;
}

/** Header words that mean a row is the table's header, not an item. */
const HEADER_WORDS = [
  "designation",
  "description",
  "libelle",
  "reference",
  "ref",
  "article",
  "qte",
  "qty",
  "quantite",
  "quantity",
  "unite",
  "unit",
  "prix",
  "price",
];

function isHeaderRow(cells: string[]): boolean {
  const words = cells.map((c) => stripAccents(c.toLowerCase()).replace(/[^a-z]/g, ""));
  const hits = words.filter((w) => w && HEADER_WORDS.includes(w)).length;
  return hits >= 2;
}

/**
 * Excel paste. Columns are already separated; the job is deciding which is
 * which, and the decision is made over the WHOLE table rather than per row.
 *
 * Per-row guessing is what produces a table where line 3's reference ended up
 * in the designation because that one row happened to have a short description.
 */
function readTabs(rows: string[][]): { lines: ParsedLine[]; ignored: string[] } {
  const body = rows.filter((cells) => !isHeaderRow(cells));
  const width = Math.max(...body.map((c) => c.length), 0);

  // Score each column across every row.
  const refScore: number[] = Array(width).fill(0);
  const qtyScore: number[] = Array(width).fill(0);
  const unitScore: number[] = Array(width).fill(0);
  const textLength: number[] = Array(width).fill(0);

  for (const cells of body) {
    cells.forEach((cell, i) => {
      const value = cell.trim();
      if (!value) return;
      if (looksLikeReference(value)) refScore[i] = (refScore[i] ?? 0) + 1;
      if (readQty(value) !== null) qtyScore[i] = (qtyScore[i] ?? 0) + 1;
      if (isUnit(value)) unitScore[i] = (unitScore[i] ?? 0) + 1;
      textLength[i] = (textLength[i] ?? 0) + value.length;
    });
  }

  const best = (scores: number[], exclude: number[]) => {
    let index = -1;
    let top = 0;
    scores.forEach((score, i) => {
      if (exclude.includes(i)) return;
      if (score > top) {
        top = score;
        index = i;
      }
    });
    // A column has to be that kind of column in most of the rows, not once.
    return top >= Math.max(1, Math.ceil(body.length / 2)) ? index : -1;
  };

  const unitCol = best(unitScore, []);
  const qtyCol = best(qtyScore, [unitCol]);
  const refCol = best(refScore, [unitCol, qtyCol]);
  // The designation is the wordiest column that is not one of the above. It is
  // chosen by total length rather than by pattern, because a designation has no
  // pattern — that is what makes it a designation.
  const designationCol = (() => {
    let index = -1;
    let longest = -1;
    textLength.forEach((length, i) => {
      if (i === unitCol || i === qtyCol || i === refCol) return;
      if (length > longest) {
        longest = length;
        index = i;
      }
    });
    return index;
  })();

  const lines: ParsedLine[] = [];
  const ignored: string[] = [];

  for (const cells of body) {
    const cell = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
    const designation = cell(designationCol);
    if (!designation) {
      const written = cells.join(" ").trim();
      if (written) ignored.push(written);
      continue;
    }
    const qty = readQty(cell(qtyCol));
    lines.push({
      position: lines.length + 1,
      reference: cell(refCol) || null,
      designation,
      qty: qty ?? "1",
      unit: cell(unitCol) || null,
      readAs: "tabs",
      qtyAssumed: qty === null,
    });
  }

  return { lines, ignored };
}

/**
 * A quantity at the END of a line: `… 12 pc`, `… x 20`, `… : 60`.
 *
 * Named because two readers now ask the same question of the same line —
 * `readProseLine` to take the quantity off the back, and `withoutBareIndex` to
 * decide whether the number on the FRONT is an index or part of the words.
 */
const TRAILING_QTY = /[\s:x×]\s*([\d][\d\s.,]*)\s*([A-Za-zÀ-ÿ.]{1,8})?\s*$/;

/**
 * A row number with no punctuation after it — `1 VP-DN80-16 Vanne papillon 12 pc`.
 *
 * THIS IS WHAT A TABLE IN A PDF LOOKS LIKE. pdf.js hands text back as
 * positioned fragments and `text-layer.ts` joins them with single spaces, so a
 * bordereau's five columns arrive as one line with nothing between them: the
 * `1.` or `1)` a person would type is not there, because the document never had
 * it — the number sat in its own cell.
 *
 * A leading number is only taken as an index when the line proves it is a table
 * row, and there are exactly two proofs:
 *
 *   1. the next token is a reference — `1 VP-DN80-16 …`. Nobody writes a
 *      designation that begins with a number and then a part number.
 *   2. the line ends in a quantity — `1 Vanne papillon DN80 12 pc`. Something
 *      is being counted at the end, so the number at the front is not the count.
 *
 * Without one of them the number stays where the client put it: `12 boulons M8`
 * is twelve bolts, not bolt number twelve, and the words are the designation.
 */
function withoutBareIndex(text: string, wasIndex: () => void): string {
  const head = text.match(/^(\d{1,3})\s+(?=\S)/);
  if (!head) return text;

  const rest = text.slice(head[0].length);
  const firstToken = rest.split(/\s+/)[0] ?? "";

  if (!looksLikeReference(firstToken) && !TRAILING_QTY.test(rest)) return text;

  wasIndex();
  return rest;
}

/**
 * A line typed into an email.
 *
 * Read from the OUTSIDE IN: strip the bullet or index off the front, strip the
 * quantity and unit off the back, look for a reference in what is left, and
 * whatever remains is the designation. Working outside-in matters because the
 * designation is the only part with no shape, so it has to be what is left over
 * rather than something matched.
 */
function readProseLine(raw: string): Omit<ParsedLine, "position"> | null {
  let text = raw.trim();
  if (!text) return null;

  let readAs: ParsedLine["readAs"] = "bare";

  // `1.` `1)` `1 -` `#1` at the front.
  const numbered = text.match(/^#?\s*(\d{1,3})\s*[.)\]:-]\s+(.*)$/);
  if (numbered) {
    text = (numbered[2] ?? "").trim();
    readAs = "numbered";
  } else {
    const dashed = text.match(/^[-–—•*]\s+(.*)$/);
    if (dashed) {
      text = (dashed[1] ?? "").trim();
      readAs = "dashed";
    } else {
      text = withoutBareIndex(text, () => {
        readAs = "numbered";
      });
    }
  }
  if (!text) return null;

  // Trailing quantity, with or without a unit: `… 12 pc`, `… x 20`, `… : 60`.
  let qty: string | null = null;
  let unit: string | null = null;

  const tail = text.match(TRAILING_QTY);
  if (tail) {
    const candidateQty = readQty(tail[1] ?? "");
    const candidateUnit = tail[2]?.trim();
    // A trailing word is only a unit if it IS one. `Vanne DN80 PN16` must not
    // lose `PN16` to a quantity reader that will take anything.
    if (candidateQty !== null && (!candidateUnit || isUnit(candidateUnit))) {
      qty = candidateQty;
      unit = candidateUnit && isUnit(candidateUnit) ? candidateUnit : null;
      // The separator goes with the quantity, not with the designation. All
      // three dashes, because a client who writes "— 12 pc" is using whichever
      // one their keyboard or their mail client produced.
      text = text
        .slice(0, tail.index)
        .trim()
        .replace(/[\s:x×,\-–—]+$/, "");
    }
  }

  // A reference is the first token, and only the first — a reference in the
  // middle of a sentence is part of the designation, which is where the client
  // put it and where it should stay.
  let reference: string | null = null;
  const parts = text.split(/\s+/);
  if (parts.length > 1 && looksLikeReference(parts[0] ?? "")) {
    reference = (parts[0] ?? "").trim();
    text = parts
      .slice(1)
      .join(" ")
      .replace(/^[\s:–—-]+/, "");
  }

  const designation = text.trim();
  if (!designation) return null;

  return {
    reference,
    designation,
    qty: qty ?? "1",
    unit,
    readAs,
    qtyAssumed: qty === null,
  };
}

/**
 * Read a paste.
 *
 * The tab test is deliberately generous — one tabbed row in five is enough,
 * because a table pasted out of Word often loses its tabs on the row where a
 * cell was empty. Getting this wrong in the other direction is worse: reading a
 * real table as prose puts the reference and the quantity into the designation
 * of every line.
 */
export function parsePaste(text: string): Paste {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim().length > 0);

  if (rows.length === 0) return { lines: [], ignored: [], shape: "empty" };

  const tabbed = rows.filter((row) => row.includes("\t")).length;
  if (tabbed >= Math.max(1, rows.length / 5)) {
    const { lines, ignored } = readTabs(rows.map((row) => row.split("\t")));
    if (lines.length > 0) return { lines, ignored, shape: "tabs" };
    // Fell through: it had tabs but no column looked like a designation. Read
    // it as prose rather than returning nothing.
  }

  // Decide the shape over the WHOLE paste, exactly as the tab reader decides
  // its columns over the whole table.
  //
  // A bare line is indistinguishable from a sentence — "Vanne à soupape DN50"
  // and "Merci de nous faire parvenir votre meilleure offre" are both just
  // words. What tells them apart is the company they keep: if the client
  // numbered or bulleted their list, then the list IS the numbered lines, and
  // everything else is a greeting. Only when nothing is marked at all does a
  // bare line get to be an item.
  const marked = rows.filter((row) => {
    const parsed = readProseLine(row);
    return parsed !== null && parsed.readAs !== "bare";
  }).length;

  const lines: ParsedLine[] = [];
  const ignored: string[] = [];
  for (const row of rows) {
    const parsed = readProseLine(row);
    if (!parsed || (marked > 0 && parsed.readAs === "bare")) {
      ignored.push(row.trim());
      continue;
    }
    lines.push({ ...parsed, position: lines.length + 1 });
  }

  return { lines, ignored, shape: "prose" };
}
