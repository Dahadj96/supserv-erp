import { normaliseWording } from "@/domain/designation";

/**
 * Screen 61 — Quick capture: the half that runs in a browser.
 *
 * THIS FILE MUST NOT IMPORT THE DATABASE, and the split is not tidiness.
 * `box.tsx` is a client component; it needs `CAPTURE_MODES` and the field
 * types. When those lived beside `read()` and `save()`, importing one constant
 * dragged `@/db` — and therefore `postgres`, and therefore `node:tls` — into
 * the browser bundle, and every render of /capture was a 500. Typecheck passed.
 * All 312 tests passed. The page was broken. A green build says the code
 * compiles, not that it renders.
 *
 * So: everything here is pure and portable. The database half is `quick.ts`,
 * which imports FROM this file and is never imported BY the browser.
 *
 * The screen's own explanation of why it exists is worth keeping in the file it
 * describes: "The things that get lost are the ones with nowhere obvious to go
 * — a paper handed to you at a site, a price agreed on the phone, a photo on
 * your phone. One box, fifteen seconds, and it is in the system attached to the
 * right thing."
 *
 * This module reads what was pasted and PROPOSES six fields. It writes nothing.
 * Screen 61 prints "Nothing is created until you press the button" under the
 * card, and that sentence is only true if the reading and the writing are
 * different functions — so they are. `read()` proposes; `save()` writes.
 *
 * The field that keeps the rest honest is "What it changes". It is not authored
 * anywhere: it is DERIVED from `Reading.writes`, the same list `save()` walks.
 * An assistant that prints "safe" while inserting rows is lying, and the only
 * way to be sure it is not lying is to compute the sentence from the rows.
 * `tests/unit/quick-capture.test.ts` holds that.
 */

/** The five buttons across the top of the card. */
export const CAPTURE_MODES = ["email", "file", "photo", "phone", "typed"] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number];

export function isCaptureMode(value: string | undefined): value is CaptureMode {
  return CAPTURE_MODES.includes((value ?? "") as CaptureMode);
}

/**
 * `matched` — resolved against a row that exists. A fact.
 * `auto`     — computed by a rule with no judgement in it, like a folder path.
 * `suggested`— a proposal a person accepts or deletes. Never acted on alone.
 * `safe`     — nothing will be written. The word is earned, not typed.
 * `unknown`  — read something, could not resolve it. Amber on screen.
 * `none`     — read nothing at all.
 */
export const FIELD_STATES = ["matched", "auto", "suggested", "safe", "unknown", "none"] as const;
export type FieldState = (typeof FIELD_STATES)[number];

export const READING_FIELDS = ["this", "from", "about", "filedTo", "changes", "followUp"] as const;
export type ReadingFieldKey = (typeof READING_FIELDS)[number];

export type ReadingField = {
  key: ReadingFieldKey;
  /**
   * An i18n key, never a sentence. Screen 61 is bilingual like every other
   * screen, and a proposal printed in French to an English user is a proposal
   * nobody reads before pressing Save.
   */
  labelKey: string;
  /** Values that came out of the text — a company name, a number. Not translated. */
  values: string[];
  state: FieldState;
  /** Only `this` carries a percentage. Everything else is resolved or it is not. */
  confidence: number | null;
  /** What it resolved to, when it resolved to a row. */
  ref: { kind: "party" | "document"; id: string } | null;
  /**
   * An amount, unformatted. Grouping and the currency's place in the string are
   * locale decisions, so they are made where the locale is known — in the page,
   * by `formatMoney`. A module that formats money is a module that has to be
   * told which language it is in, and this one deliberately is not.
   */
  money: { amount: string; currency: string } | null;
  /**
   * Printed under the field in grey. This is where a proposal admits what it
   * cannot do yet — a follow-up that nothing will remind you about says so
   * here, rather than letting a person believe an alarm was set.
   */
  caveatKey: string | null;
};

/** One row `save()` will insert. The plan, written down before it runs. */
export type PlannedWrite = {
  table: string;
  /** i18n key describing it, for "What it changes". */
  labelKey: string;
};

export type Reading = {
  mode: CaptureMode;
  fields: ReadingField[];
  /** Exactly what Save will create. Empty means Save creates nothing. */
  writes: PlannedWrite[];
  /** Set when the text was too thin to read anything at all. */
  tooThin: boolean;
};

/* ------------------------------------------------------------- what we see */

export type Sighting =
  | { kind: "reference"; value: string; quote: string }
  | { kind: "amount"; value: string; currency: string; quote: string }
  | { kind: "email"; value: string; quote: string }
  | { kind: "date"; value: string; quote: string };

/**
 * A document reference: two or more groups separated by slashes, at least one
 * of them digits. `SUP/2026/0034`, `PR 3000116322/2026`, `FA-2026-118`.
 *
 * Deliberately loose, because the numbering pattern is configurable (see
 * `renderPattern`) and this module has no business knowing what this year's
 * series looks like. Loose is safe here: a sighting is only ever a candidate,
 * and it becomes `matched` in `compose()` only if a document with that exact
 * number is in the database. A reference nobody issued stays `unknown`.
 */
const REFERENCE = /\b[A-Z]{2,6}[/-]\d{2,4}[/-]\d{1,6}\b/g;

/**
 * An amount in DZD or EUR. Reuses nothing from `routing.ts` on purpose: that
 * one answers "is there a price in here at all" and may say yes loosely. This
 * one has to hand back the number, so it is stricter about what it will take.
 */
const AMOUNT = /(\d[\d\s. ]{2,}(?:,\d{1,2})?)\s*(DA|DZD|EUR|€)\b/gi;

const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

/** Normalises 5 640 000 / 5.640.000 / 5,640,000 to 5640000. */
export function readAmount(raw: string): string | null {
  const cleaned = raw.replace(/[\s ]/g, "");
  // A comma with one or two digits after it is a decimal separator here.
  const decimal = cleaned.match(/^(.*),(\d{1,2})$/);
  const whole = (decimal?.[1] ?? cleaned).replace(/[.,]/g, "");
  if (!/^\d+$/.test(whole)) return null;
  return decimal ? `${whole}.${decimal[2]}` : whole;
}

/** Everything the text plainly contains. No interpretation yet. */
export function sight(text: string): Sighting[] {
  const out: Sighting[] = [];
  const seen = new Set<string>();

  const push = (s: Sighting) => {
    const dedupe = `${s.kind}:${s.value}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push(s);
  };

  for (const m of text.matchAll(REFERENCE)) {
    push({ kind: "reference", value: m[0], quote: lineAround(text, m.index ?? 0) });
  }
  for (const m of text.matchAll(AMOUNT)) {
    const value = readAmount(m[1] ?? "");
    if (!value) continue;
    const currency = (m[2] ?? "").toUpperCase() === "€" ? "EUR" : (m[2] ?? "").toUpperCase();
    push({
      kind: "amount",
      value,
      currency: currency === "DA" ? "DZD" : currency,
      quote: lineAround(text, m.index ?? 0),
    });
  }
  for (const m of text.matchAll(EMAIL)) {
    push({ kind: "email", value: m[0].toLowerCase(), quote: lineAround(text, m.index ?? 0) });
  }
  return out;
}

/** The line a match sits on, so every proposal can be checked against the text. */
function lineAround(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  const line = text.slice(start, end === -1 ? undefined : end).trim();
  return line.length > 200 ? `${line.slice(0, 197)}…` : line;
}

/* ----------------------------------------------------------- what this is */

/**
 * The shapes on the right-hand card — "It handles these too" — plus the two the
 * mockup shows in the box itself.
 *
 * Cues are French and English because both languages arrive in the same inbox
 * on the same day. They are matched after `normaliseWording`, so `règlement`
 * and `reglement` are the same cue and nobody has to remember which one the
 * sender typed.
 */
export const SHAPES = [
  "paymentUpdate",
  "deliveryProof",
  "priceList",
  "enquiry",
  "contactCard",
  "phoneNote",
  "unknown",
] as const;
export type Shape = (typeof SHAPES)[number];

type ShapeRule = {
  shape: Shape;
  cues: string[];
  /** Raises confidence when the text also contains one of these sightings. */
  wants: Sighting["kind"][];
  base: number;
};

const SHAPE_RULES: ShapeRule[] = [
  {
    shape: "paymentUpdate",
    cues: [
      "reglement",
      "en cours de reglement",
      "service financier",
      "virement",
      "paiement",
      "payment",
      "paid",
      "remittance",
      "avis de credit",
    ],
    wants: ["reference"],
    base: 0.72,
  },
  {
    shape: "deliveryProof",
    cues: ["bon de livraison", "delivery note", "receptionne", "livre le", "signed for"],
    wants: ["reference"],
    base: 0.7,
  },
  {
    shape: "priceList",
    cues: ["liste de prix", "price list", "tarif", "nos prix", "catalogue", "quotation valid"],
    wants: ["amount"],
    base: 0.66,
  },
  {
    shape: "enquiry",
    cues: [
      "demande de prix",
      "consultation",
      "appel d offres",
      "merci de nous faire parvenir",
      "please quote",
      "request for quotation",
      "rfq",
    ],
    wants: [],
    base: 0.7,
  },
  {
    shape: "contactCard",
    cues: ["carte de visite", "business card", "gerant", "directeur", "responsable achats"],
    wants: ["email"],
    base: 0.6,
  },
];

/**
 * Which shape, and how sure.
 *
 * A phone note is never guessed at from its words — the person pressed the
 * "Phone note" button, which is a fact about what they meant, and a fact beats
 * a regular expression. That is why `mode` is an argument here.
 */
export function classify(
  text: string,
  mode: CaptureMode,
  sightings: Sighting[],
): { shape: Shape; confidence: number } {
  if (mode === "phone") return { shape: "phoneNote", confidence: 1 };

  const flat = normaliseWording(text);
  const kinds = new Set(sightings.map((s) => s.kind));

  let best: { shape: Shape; confidence: number } = { shape: "unknown", confidence: 0 };

  for (const rule of SHAPE_RULES) {
    const hits = rule.cues.filter((cue) => flat.includes(normaliseWording(cue)));
    if (hits.length === 0) continue;

    let score = rule.base;
    // A second cue is real corroboration. A third is the same sender being
    // wordy, so it stops counting there.
    if (hits.length >= 2) score += 0.14;
    if (rule.wants.some((kind) => kinds.has(kind))) score += 0.12;
    // Two shapes both fired. Neither of them is 96% certain of anything.
    if (best.confidence > 0) score -= 0.1;

    if (score > best.confidence) best = { shape: rule.shape, confidence: Math.min(0.98, score) };
  }

  return best;
}

/* ------------------------------------------------------------ the reading */

/** What the database said about the things we sighted. Resolved by `read()`. */
export type Resolved = {
  party: { id: string; name: string; isClient: boolean } | null;
  document: {
    id: string;
    number: string;
    kind: string;
    totalIncl: string;
    currency: string;
  } | null;
};

/**
 * Folder names are NOT translated, and that is deliberate.
 *
 * Every other string on this screen is an i18n key, because it is read by a
 * person. A folder name is not read by a person — it IS the folder. Translate
 * it and the same client's correspondence lands in `Clients/URBACON/2026/
 * Correspondance` for whoever captured it in French and `Clients/URBACON/2026/
 * Correspondence` for whoever captured it in English, and now there are two
 * folders and nobody can find anything. One spelling, forever, in the language
 * the company files in.
 */
export function filingPath(opts: {
  party: { name: string; isClient: boolean } | null;
  shape: Shape;
  year: number;
}): string[] | null {
  if (!opts.party) return null;
  const leaf =
    opts.shape === "deliveryProof"
      ? "Livraisons"
      : opts.shape === "priceList"
        ? "Prix"
        : "Correspondance";
  return [
    opts.party.isClient ? "Clients" : "Fournisseurs",
    opts.party.name,
    String(opts.year),
    leaf,
  ];
}

/** Below this there is nothing to read, and pretending otherwise wastes a click. */
export const TOO_THIN_CHARS = 12;

/**
 * Every proposal starts out claiming nothing: no value, no confidence, no row
 * behind it, no money. A field earns each of those by passing it in. A default
 * of `null` everywhere means a new field added in a hurry is uninformative
 * rather than quietly wrong.
 */
function field(
  key: ReadingFieldKey,
  labelKey: string,
  state: FieldState,
  extra: Partial<Omit<ReadingField, "key" | "labelKey" | "state">> = {},
): ReadingField {
  return {
    key,
    labelKey,
    state,
    values: [],
    confidence: null,
    ref: null,
    money: null,
    caveatKey: null,
    ...extra,
  };
}

/**
 * Build the six proposals. Pure — give it the same arguments twice and it
 * returns the same reading, which is what makes it testable and what makes
 * "nothing is created until you press the button" checkable.
 */
export function compose(input: {
  mode: CaptureMode;
  text: string;
  sightings: Sighting[];
  resolved: Resolved;
  today: Date;
}): Reading {
  const { mode, text, sightings, resolved, today } = input;
  const tooThin = text.trim().length < TOO_THIN_CHARS;

  const { shape, confidence } = classify(text, mode, sightings);
  const reference = sightings.find((s) => s.kind === "reference");
  const amount = sightings.find((s) => s.kind === "amount");

  // The plan first. "What it changes" is read off it below, so it cannot drift
  // away from what actually happens.
  const writes: PlannedWrite[] = tooThin
    ? []
    : [{ table: "intake_message", labelKey: "writes.note" }];

  const fields: ReadingField[] = [];

  fields.push(
    shape === "unknown"
      ? field("this", "shape.unknown", "unknown", { caveatKey: "couldNotTell" })
      : field("this", `shape.${shape}`, "suggested", { confidence }),
  );

  // From. An address we could not place is still worth showing — it is the
  // thing a person needs in order to say "that is Sonatrach, file it there".
  const sender = sightings.find((s) => s.kind === "email");
  fields.push(
    resolved.party
      ? field(
          "from",
          resolved.party.isClient ? "from.knownClient" : "from.knownSupplier",
          "matched",
          {
            values: [resolved.party.name],
            ref: { kind: "party", id: resolved.party.id },
          },
        )
      : sender
        ? field("from", "from.unplacedAddress", "unknown", {
            values: [sender.value],
            caveatKey: "addressNotOnAnyCompany",
          })
        : field("from", "from.nobody", "none"),
  );

  // About. A reference is `matched` only when a document carries that number.
  // A reference that matches nothing is the interesting case — it is usually a
  // typo, or a document somebody else issued, and both need a person.
  if (resolved.document) {
    const doc = resolved.document;
    // An amount in the email that is not the amount on the invoice is the most
    // useful thing this screen can notice. It is usually a part payment, and it
    // is occasionally the wrong invoice.
    const differs = amount !== undefined && !sameAmount(amount.value, doc.totalIncl);
    fields.push(
      field("about", "about.document", "matched", {
        values: [doc.number],
        money: { amount: doc.totalIncl, currency: doc.currency },
        ref: { kind: "document", id: doc.id },
        caveatKey: differs ? "amountDiffersFromDocument" : null,
      }),
    );
  } else if (reference) {
    fields.push(
      field("about", "about.unmatchedReference", "unknown", {
        values: [reference.value],
        caveatKey: "noDocumentWithThatNumber",
      }),
    );
  } else if (amount) {
    fields.push(
      field("about", "about.amountOnly", "unknown", {
        money: { amount: amount.value, currency: amount.currency },
      }),
    );
  } else {
    fields.push(field("about", "about.nothing", "none"));
  }

  // Filed to. The mockup badges this `auto` — the path is arithmetic, there is
  // no judgement in it. What there is, is a gap: nothing files to SharePoint
  // yet. The path is computed and recorded so that when filing is built it has
  // somewhere to start, and the caveat says plainly that no folder was touched.
  const path = filingPath({ party: resolved.party, shape, year: today.getFullYear() });
  fields.push(
    path
      ? field("filedTo", "filedTo.path", "auto", {
          values: path,
          caveatKey: "filingNotConnected",
        })
      : field("filedTo", "filedTo.noCompanyYet", "none"),
  );

  // What it changes. DERIVED — see the note at the top of the file.
  fields.push(
    writes.length === 0
      ? field("changes", "changes.nothing", "safe")
      : field("changes", "changes.creates", "suggested"),
  );

  // Follow-up. Proposed only when there is something to follow up ON — a
  // payment that has not arrived, a quote that will go stale. A reminder
  // attached to nothing is noise, and noise is how the twelve expired unread.
  const followUp = proposeFollowUp({ shape, resolved, today });
  fields.push(
    followUp
      ? field("followUp", "followUp.on", "suggested", {
          values: [followUp],
          caveatKey: "remindersNotBuiltYet",
        })
      : field("followUp", "followUp.none", "none"),
  );

  return { mode, fields, writes, tooThin };
}

/** 5 640 000 and 5640000.00 are the same amount. Compared as numbers, not text. */
function sameAmount(a: string, b: string): boolean {
  const left = Number(a);
  const right = Number(b);
  if (Number.isNaN(left) || Number.isNaN(right)) return false;
  // Two centimes apart is a rounding difference somebody else made, not a
  // disagreement worth putting an amber badge on a screen for.
  return Math.abs(left - right) < 0.02;
}

/**
 * "Remind me on 31 Aug if no payment."
 *
 * The date is the end of the month the sender promised, because that is what
 * "avant la fin du mois" means and it is the only date in the whole exchange
 * that anybody actually committed to. When nobody committed to anything, this
 * returns null rather than inventing a fortnight.
 */
export function proposeFollowUp(input: {
  shape: Shape;
  resolved: Resolved;
  today: Date;
}): string | null {
  const { shape, resolved, today } = input;
  if (shape !== "paymentUpdate") return null;
  if (!resolved.document) return null;
  if (resolved.document.kind !== "invoice") return null;

  const endOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  return endOfMonth.toISOString().slice(0, 10);
}

/**
 * The one sentence a person reads before pressing Save, in machine form.
 *
 * `save()` asserts this matches what it is about to do. If a future change adds
 * an insert without adding it to the plan, the assertion fires in a test rather
 * than in a month when somebody notices rows they never agreed to.
 */
export function writeSummary(reading: Reading): string[] {
  return reading.writes.map((w) => w.table).sort();
}
