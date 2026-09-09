import type { PageText } from "@/capture/ocr/text-layer";

/**
 * Screen 40 — "Review what we read".
 *
 * "This is the only place extraction becomes fact. A wrong deadline or a
 * missing document on this list loses the bid — so a person confirms every
 * field against the page it came from."
 *
 * Two consequences run through this whole file:
 *
 *   1. Nothing here writes anything. It PROPOSES, with a citation, and the
 *      proposal is worthless until somebody confirms it. LAW 2.
 *   2. Every proposal carries the page and the exact sentence it came from.
 *      A field without a citation cannot be checked, and a field that cannot be
 *      checked has no business being on this screen.
 */

export const FIELD_KEYS = [
  "submissionDeadline",
  "openingSession",
  "whereToDeposit",
  "bidBond",
  "offerValidity",
  "latePenalty",
  /*
    HOW LONG THE CLIENT GIVES US TO DELIVER (task 2.4c).

    The seventh, added after 2.4 found that `deal.required_delivery_days` was
    the one column with no writer anywhere: the carrying was built and there
    was nothing to carry, because nothing ever proposed the value. Screen 67
    checks every supplier's promised lead time against it and had been checking
    against null on every deal there has ever been.
  */
  "deliveryTime",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export type Citation = {
  page: number;
  /** The sentence, verbatim. What the amber highlight on screen 40 shows. */
  quote: string;
  /** "article 7", when the document numbers its articles. */
  article: string | null;
};

export type ProposedField = {
  key: FieldKey;
  /** Normalised for storage. An ISO date, a number, a plain string. */
  value: string;
  /** As it appeared, for the input box a person corrects. */
  display: string;
  confidence: number;
  citation: Citation;
  /** Why it is not certain. Printed under the field, as on screen 40. */
  caveat: string | null;
};

/* ------------------------------------------------------------------ dates */

const MONTHS: Record<string, number> = {
  janvier: 1,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
};

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * "02 septembre 2026 à 10 heures 00" → 2026-09-02T10:00.
 *
 * Written for what Algerian tender documents actually say, which is French
 * month names and "à 10 heures 00" far more often than a numeric time.
 */
export function readFrenchDateTime(text: string): { iso: string; display: string } | null {
  const flat = stripAccents(text.toLowerCase());

  const named = flat.match(
    /(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(\d{4})/,
  );
  const numeric = flat.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);

  let year: number;
  let month: number;
  let day: number;

  if (named) {
    day = Number(named[1]);
    month = MONTHS[named[2] as string] ?? 0;
    year = Number(named[3]);
  } else if (numeric) {
    // Day first. This is an Algerian office.
    day = Number(numeric[1]);
    month = Number(numeric[2]);
    year = Number(numeric[3]);
  } else {
    return null;
  }
  if (!month || !day || !year) return null;

  // "à 10 heures 00" / "à 10h00" / "10:00"
  const time =
    flat.match(/(\d{1,2})\s*(?:heures?|h)\s*(\d{2})?/) ?? flat.match(/(\d{1,2}):(\d{2})/);
  const hour = time ? Number(time[1]) : 0;
  const minute = time?.[2] ? Number(time[2]) : 0;

  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`;
  const display = `${pad(day)}/${pad(month)}/${year}${time ? ` · ${pad(hour)}:${pad(minute)}` : ""}`;
  return { iso, display };
}

/* -------------------------------------------------------------- the rules */

type Rule = {
  key: FieldKey;
  /** Any of these near the value. Matched after accents are stripped. */
  cues: string[];
  /** Pulls the value out of a sentence that matched a cue. */
  read: (sentence: string) => { value: string; display: string } | null;
  /** Raised when the sentence is short and the cue is unambiguous. */
  base: number;
};

const RULES: Rule[] = [
  {
    key: "submissionDeadline",
    cues: [
      "date limite de depot",
      "au plus tard le",
      "date et heure limites",
      "depot des offres",
      "remise des offres",
    ],
    read: (s) => {
      const d = readFrenchDateTime(s);
      return d ? { value: d.iso, display: d.display } : null;
    },
    base: 0.9,
  },
  {
    key: "openingSession",
    cues: ["ouverture des plis", "seance publique", "ouverture des offres"],
    read: (s) => {
      const d = readFrenchDateTime(s);
      if (d) return { value: d.iso, display: d.display };

      // "L'ouverture des plis aura lieu LE MÊME JOUR à 14 heures 00."
      //
      // Every one of these documents says it this way, and a reader that
      // demands a date in the same sentence finds nothing. The day is resolved
      // from the submission deadline in `proposeFields`.
      const flat = stripAccents(s.toLowerCase());
      if (!/m[êe]me jour|meme jour|le jour m[êe]me/.test(flat)) return null;
      const time = flat.match(/(\d{1,2})\s*(?:heures?|h)\s*(\d{2})?/);
      if (!time) return null;
      const pad = (n: number) => String(n).padStart(2, "0");
      return {
        value: `SAME_DAY:${pad(Number(time[1]))}:${pad(Number(time[2] ?? 0))}`,
        display: `même jour · ${pad(Number(time[1]))}:${pad(Number(time[2] ?? 0))}`,
      };
    },
    base: 0.88,
  },
  {
    key: "whereToDeposit",
    cues: ["bureau des marches", "adresse de depot", "deposees au", "deposees aupres"],
    read: (s) => {
      // Everything from the bureau to the end of the clause.
      const m = s.match(/(bureau des march[ée]s[^.,;]*)/i) ?? s.match(/au\s+([^.,;]{6,80})/i);
      const value = m?.[1]?.trim();
      return value ? { value, display: value } : null;
    },
    base: 0.8,
  },
  {
    key: "bidBond",
    cues: ["caution de soumission", "cautionnement provisoire", "garantie de soumission"],
    read: (s) => {
      const amount = s.match(/([\d][\d\s.,]{2,})\s*(da|dzd|dinars?)/i);
      const percent = s.match(/(\d+(?:[.,]\d+)?)\s*%/);
      if (!amount && !percent) return null;
      const parts = [
        amount ? `${amount[1]?.replace(/\s+/g, " ").trim()} DZD` : null,
        percent ? `(${percent[1]}%)` : null,
      ].filter(Boolean);
      const value = parts.join(" ");
      return { value, display: value };
    },
    base: 0.85,
  },
  {
    key: "offerValidity",
    /*
      The first three are how a règlement de consultation puts it — as a
      heading, or as a clause naming the thing. Measured on 9 September (task
      2.4a): none of them appears anywhere in the six readable files of the
      real RFQ on this database. A private *consultation restreinte* does not
      name the field, it states the obligation in a sentence —

        "1.6.18 L'offre doit rester valable pour une période minimale de
         180 jours calendaires à partir de la date…"

      — which is the same fact, written the way a person writes it rather than
      the way a form labels it. The last two cues are that sentence's verb.
    */
    cues: [
      "delai de validite",
      "validite des offres",
      "duree de validite",
      "rester valable",
      "demeurer valable",
    ],
    read: (s) => {
      const m = s.match(/(\d{1,3})\s*(jours?|mois)/i);
      if (!m) return null;
      const value = `${m[1]} ${m[2]?.toLowerCase()}`;
      return { value, display: value };
    },
    base: 0.9,
  },
  {
    /*
      DELIVERY TIME — task 2.4c.

      Kept apart from `offerValidity` on purpose, though both end in a count of
      days. They are opposite obligations: a validity is how long OUR price
      stands, a delivery time is how fast the CLIENT requires the goods. Reading
      one as the other would put a lead time into the field screen 12 uses to
      decide whether our offer has expired.

      Nothing about the two cue lists overlaps — *validité* and *livraison* are
      different words — so the separation is in the vocabulary rather than in an
      ordering that could be broken by moving a rule.

      What this reads is a NUMBER, and a person confirms the meaning. "inférieur
      ou égal à 15 jours" is a maximum the client set, which is exactly what
      `required_delivery_days` holds; "à partir de 15 jours" would be the
      opposite claim in the same words, and no regular expression should be
      trusted to tell them apart on a document that decides a penalty.
    */
    key: "deliveryTime",
    cues: ["delai de livraison", "delais de livraison", "livraison sous", "delai de fourniture"],
    read: (s) => {
      const m = s.match(/(\d{1,3})\s*(jours?|mois|semaines?)/i);
      if (!m) return null;
      const value = `${m[1]} ${m[2]?.toLowerCase()}`;
      return { value, display: value };
    },
    // Lower than a validity's 0.9. A contract mentions delivery in a dozen
    // clauses and only one of them is the requirement.
    base: 0.8,
  },
  {
    key: "latePenalty",
    cues: ["penalites de retard", "penalite de retard", "penalites"],
    read: (s) => {
      const rate = s.match(/(\d+(?:[.,]\d+)?)\s*(‰|%|pour mille)/);
      const cap = s.match(/plafonn[ée]e?s?\s*[aà]\s*(\d+(?:[.,]\d+)?)\s*%/i);
      if (!rate) return null;
      const value = `${rate[1]}${rate[2] === "pour mille" ? "‰" : rate[2]} par jour${
        cap ? `, plafonné à ${cap[1]}%` : ""
      }`;
      return { value, display: value };
    },
    base: 0.7,
  },
];

/* ------------------------------------------------------------- the reader */

/** "ARTICLE 7 — PRÉSENTATION DES OFFRES" → "article 7". */
function articleAbove(lines: string[], index: number): string | null {
  for (let i = index; i >= 0 && i > index - 40; i--) {
    const m = stripAccents(lines[i] ?? "").match(/^article\s+(\d{1,3})\b/i);
    if (m) return `article ${m[1]}`;
  }
  return null;
}

/**
 * How far below a cue a rule may look for its value.
 *
 * TWO, measured rather than chosen (task 2.4b). The case this exists for is
 * `F_RFQ-…_Projet de Contrat.pdf`, where "ARTICLE 13 – PENALITES DE RETARD" is
 * a heading and the rate is eleven lines under it. A window big enough to span
 * that would reach halfway into the next article and read whatever number it
 * found there — which is not a reader, it is a guess with a citation attached.
 *
 * It does not need to be. A French administrative document repeats its own
 * words: eleven lines below the heading, clause 13.3 says "…paiera au CLIENT
 * des pénalités de" and the very next line says "retard comme suit : 1 % par
 * jour…". The cue fires again next to the value, so a window of two lines
 * reaches it and a window of eleven is never wanted. What is being crossed
 * here is a LINE BREAK, not a paragraph.
 */
const CUE_WINDOW = 2;

/**
 * "ARTICLE 13 – PENALITES DE RETARD ............................ 12"
 *
 * A table of contents carries every heading in the document, so every cue
 * appears there first — and the line under one heading is the next heading,
 * not its clause. Four dots in a row are dot leaders and occur nowhere else,
 * so a cue found on such a line never looks below it.
 */
function isContentsEntry(line: string): boolean {
  return /\.{4,}/.test(line);
}

/**
 * Sentences, not lines.
 *
 * A citation must be something a person can find on the page with their eye.
 * A pdf.js line is a fragment; a sentence is what was written.
 */
function sentencesOf(lines: string[]): { text: string; lineIndex: number }[] {
  const out: { text: string; lineIndex: number }[] = [];
  lines.forEach((line, lineIndex) => {
    for (const part of line.split(/(?<=[.;])\s+/)) {
      const text = part.trim();
      if (text.length > 12) out.push({ text, lineIndex });
    }
  });
  return out;
}

/**
 * Confidence, and why it is not a model score.
 *
 * There is no model here. The number says how much corroboration the reading
 * has: the cue was found, a value was parsed out of the same sentence, and the
 * sentence was short enough that the two are plainly about each other. A long
 * paragraph containing both a deadline cue and a date might be joining them or
 * might be discussing two different dates, and screen 40 shows that as amber
 * rather than green so a person looks harder at it.
 */
function scoreOf(
  rule: Rule,
  sentence: string,
  cueCount: number,
  belowCue: boolean,
): { score: number; caveat: string | null } {
  let score = rule.base;
  let caveat: string | null = null;

  if (belowCue) {
    /*
      The cue and the value are on different lines, so the reader joined two
      things the document did not put in one sentence. Usually that is a line
      break inside a clause and the join is exactly right; occasionally it is a
      heading followed by something unrelated. The person is told which, and
      told first, because it is the caveat that says where to look.
    */
    score -= 0.15;
    caveat = "readBelowCue";
  }
  if (sentence.length > 220) {
    score -= 0.2;
    // `??`, so a value read below its cue keeps the caveat that says so. With
    // no `belowCue` this is `null ?? "longSentence"` and nothing changes.
    caveat = caveat ?? "longSentence";
  }
  if (cueCount > 1) {
    // The same cue appears more than once in the document — which of them is
    // THE deadline is exactly the sort of thing a person settles in a second
    // and a regular expression never does.
    score -= 0.15;
    caveat = caveat ?? "severalCandidates";
  }
  if (/environ|approximativement|sauf|le cas ech[ée]ant|éventuel/i.test(sentence)) {
    score -= 0.25;
    caveat = "hedged";
  }

  return { score: Math.max(0.3, Math.min(0.99, score)), caveat };
}

/**
 * Read a whole document.
 *
 * Returns at most one proposal per field — the best-scoring one — because
 * screen 40 asks a person to confirm a value, not to choose between six.
 */
export function proposeFields(pages: PageText[]): ProposedField[] {
  type Hit = {
    rule: Rule;
    page: PageText;
    sentence: string;
    lineIndex: number;
    read: { value: string; display: string };
    /** The value was found under the cue rather than in the same sentence. */
    belowCue: boolean;
  };

  // One pass to find everything, so a rule can be scored against how often it
  // fired in the WHOLE document. Counting per page said "one candidate" for a
  // deadline that a later article had already postponed.
  const hits: Hit[] = [];
  for (const page of pages) {
    const sentences = sentencesOf(page.lines);

    for (const s of sentences) {
      const flat = stripAccents(s.text.toLowerCase());
      for (const rule of RULES) {
        if (!rule.cues.some((cue) => flat.includes(cue))) continue;

        const here = rule.read(s.text);
        if (here) {
          hits.push({
            rule,
            page,
            sentence: s.text,
            lineIndex: s.lineIndex,
            read: here,
            belowCue: false,
          });
          continue;
        }

        /*
          THE CUE IS HERE AND THE VALUE IS NOT.

          A numbered French document says the label and then says the fact, and
          a PDF text layer breaks both into lines. Looking only inside the cue's
          own sentence made every such document unreadable — measured in 2.4a on
          a real draft contract whose penalty rate sits one line below the words
          "des pénalités de".

          The citation follows the VALUE, not the cue: a person confirming a
          rate has to be able to see the rate on the page they are sent to, and
          a citation pointing at a heading is a field nobody can check — the one
          thing screen 40 may not produce. The caveat says it was read below.
        */
        if (isContentsEntry(s.text)) continue;

        for (const under of sentences) {
          if (under.lineIndex <= s.lineIndex) continue;
          if (under.lineIndex > s.lineIndex + CUE_WINDOW) break;

          const read = rule.read(under.text);
          if (!read) continue;

          hits.push({
            rule,
            page,
            sentence: under.text,
            lineIndex: under.lineIndex,
            read,
            belowCue: true,
          });
          break;
        }
      }
    }
  }

  /*
    ONE READING ARRIVED AT TWICE IS STILL ONE READING.

    "ARTICLE 11 — DÉLAI DE VALIDITÉ DES OFFRES" names the field, and the clause
    under it — "Le délai de validité des offres est fixé à 90 jours" — states
    it and carries the cue again. The window turns the heading into a hit on
    that clause, and the clause makes its own; both land on the same line with
    the same value, and counting them as two candidates fires
    `severalCandidates` on a document that said it once. That is the commonest
    layout there is, so the caveat would have been permanently on.

    Same rule, same page, same line is one hit — and the DIRECT reading wins,
    because a value found beside its cue is more certain than the same value
    found under one.
  */
  const seen = new Set<string>();
  const distinct: Hit[] = [];
  for (const h of [...hits.filter((x) => !x.belowCue), ...hits.filter((x) => x.belowCue)]) {
    const at = `${h.rule.key}|${h.page.page}|${h.lineIndex}`;
    if (seen.has(at)) continue;
    seen.add(at);
    distinct.push(h);
  }

  const perKey = new Map<FieldKey, number>();
  for (const h of distinct) perKey.set(h.rule.key, (perKey.get(h.rule.key) ?? 0) + 1);

  const candidates = new Map<FieldKey, ProposedField[]>();
  for (const h of distinct) {
    const { score, caveat } = scoreOf(h.rule, h.sentence, perKey.get(h.rule.key) ?? 1, h.belowCue);
    const list = candidates.get(h.rule.key) ?? [];
    list.push({
      key: h.rule.key,
      value: h.read.value,
      display: h.read.display,
      confidence: score,
      caveat,
      citation: {
        page: h.page.page,
        quote: h.sentence.length > 240 ? `${h.sentence.slice(0, 237)}…` : h.sentence,
        article: articleAbove(h.page.lines, h.lineIndex),
      },
    });
    candidates.set(h.rule.key, list);
  }

  const best: ProposedField[] = [];
  for (const key of FIELD_KEYS) {
    const list = candidates.get(key);
    if (!list || list.length === 0) continue;
    list.sort((a, b) => b.confidence - a.confidence);
    const top = list[0];
    if (top) best.push(top);
  }

  return resolveSameDay(best);
}

/**
 * "le même jour" only means something next to the day it refers to.
 *
 * If the deadline is known, the opening session inherits its date. If it is
 * not, the field keeps its marker and is flagged — because an opening session
 * with no day is exactly the sort of half-fact this screen exists to catch.
 */
function resolveSameDay(fields: ProposedField[]): ProposedField[] {
  const deadline = fields.find((f) => f.key === "submissionDeadline");

  return fields.map((field) => {
    if (!field.value.startsWith("SAME_DAY:")) return field;

    const time = field.value.slice("SAME_DAY:".length);
    const day = deadline?.value.slice(0, 10);

    if (!deadline || !day || deadline.value.startsWith("SAME_DAY:")) {
      return { ...field, caveat: "dayUnknown", confidence: Math.min(field.confidence, 0.6) };
    }

    const [dd, mm, yyyy] = [day.slice(8, 10), day.slice(5, 7), day.slice(0, 4)];
    return {
      ...field,
      value: `${day}T${time}:00`,
      display: `${dd}/${mm}/${yyyy} · ${time}`,
      // It was read from two sentences rather than one, and the person should
      // know that before confirming it.
      caveat: field.caveat ?? "sameDayAsDeadline",
      confidence: Math.min(field.confidence, deadline.confidence),
    };
  });
}

/**
 * Screen 40's "Confirm all high confidence" button.
 *
 * The threshold is `REVIEW_THRESHOLD` from the OCR provider — 0.8 — and it is
 * the same number the safety rails use for a different purpose, deliberately:
 * one idea of "sure enough" across the whole system is one idea to argue about.
 */
export function highConfidence(fields: ProposedField[], threshold: number): ProposedField[] {
  return fields.filter((f) => f.confidence >= threshold && f.caveat === null);
}
