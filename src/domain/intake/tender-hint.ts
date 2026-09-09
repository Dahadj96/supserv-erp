import { looksLikeArchive } from "@/capture/archive/zip";
import { normaliseWording } from "../designation";
import { RULES } from "./channels";
import type { RoutedTo } from "./routing";

/**
 * Screen 02 — "this looks like a tender".
 *
 * WHY THIS EXISTS. Every signal below was already being computed and thrown
 * away. The router reads the subject for *consultation · avis · appel d'offres*
 * and, when an earlier rule wins, that reading is discarded. `attachmentLooksLike`
 * tags `cahier|charges|cctp|dossier|appel` as `tender_dossier` and writes it on
 * the row, where nothing but a badge ever reads it. A dossier arrives as a ZIP
 * and the archive is expanded without anybody asking what an archive full of
 * files on an enquiry usually means.
 *
 * So an RFQ that is plainly an appel d'offres — five attachments, a
 * `dossier.zip`, a CCTP inside it — opens as a plain enquiry, and the person
 * who knows better has to notice, scroll to a select box, and change it.
 *
 * WHAT IT MAY NOT DO. Decide. LAW 2: this proposes, and a person chooses. It
 * writes nothing, it never reclassifies on its own, and it fires only where a
 * person is looking at the message. `route()` is unchanged and `classifiedAs`
 * is unchanged — a hint that quietly rewrote the classification would be the
 * router with an extra step, not a suggestion.
 *
 * It also carries its reasons. A suggestion with no reason is an oracle, and
 * the screen prints every signal that fired so the person can disagree with a
 * particular one rather than with the machine.
 */

export const TENDER_SIGNALS = [
  /** The subject names a formal procedure — the words the tender rule matches. */
  "procedureNamed",
  /** An attachment the filename classifier already called a tender dossier. */
  "dossierAttached",
  /** It arrived as an archive. A dossier is a folder before it is an email. */
  "archive",
  /** Several files at once. On its own this means little; with an archive it does. */
  "manyFiles",
] as const;

export type TenderSignal = (typeof TENDER_SIGNALS)[number];

/**
 * What each signal is worth, and the score at which the screen says something.
 *
 * The two strong signals each carry the hint alone, because each is somebody
 * else's word rather than our inference: the subject was typed by the authority
 * announcing the procedure, and `tender_dossier` is the filename the sender
 * chose. The two weak ones carry it only together — an archive by itself is a
 * supplier's photographs as often as it is a dossier, and four attachments by
 * itself is a catalogue.
 */
const WEIGHTS: Record<TenderSignal, number> = {
  procedureNamed: 3,
  dossierAttached: 3,
  archive: 2,
  manyFiles: 1,
};

export const TENDER_HINT_FLOOR = 3;

/** Four is where "some attachments" stops being an ordinary email. */
export const MANY_FILES = 4;

/**
 * The words, read off the seeded tender rule rather than retyped.
 *
 * There is one list of words that mean a formal procedure in this repository
 * and it is the one on screen 38. Copying it here would mean somebody adding
 * *manifestation d'intérêt* to the rule and this hint going on ignoring it for
 * a year.
 */
const PROCEDURE_WORDS: string[] =
  RULES.find((rule) => rule.creates === "tender")?.matcher.subjectContains ?? [];

export type HintAttachment = {
  filename: string;
  contentType: string | null;
  looksLike: string | null;
};

export type TenderHintFacts = {
  /** What the router decided. A message already headed for a tender needs no hint. */
  classifiedAs: RoutedTo | null;
  subject: string | null;
  /**
   * Only what the MESSAGE carried. Files that came out of an archive are not
   * counted: a zip holding eight pieces would otherwise score `manyFiles` twice
   * over, once for being an archive and once for what is in it, and the count
   * on the screen would stop matching the count in the paperclip list.
   */
  attachments: HintAttachment[];
};

export type TenderHint = {
  /** Whether the screen says anything at all. */
  show: boolean;
  score: number;
  /** Every signal that fired, in the order they are declared. The screen lists them. */
  signals: TenderSignal[];
};

function subjectNamesAProcedure(subject: string | null): boolean {
  if (!subject || PROCEDURE_WORDS.length === 0) return false;
  const hay = normaliseWording(subject);
  return PROCEDURE_WORDS.some((word) => hay.includes(normaliseWording(word)));
}

/**
 * Read the signals off one message.
 *
 * Pure, and deliberately takes facts rather than an id: the screen already has
 * every one of them loaded, and a hint that made its own queries would be a
 * second opinion computed from different rows than the ones on display.
 */
export function tenderHint(facts: TenderHintFacts): TenderHint {
  /*
    ALREADY A TENDER — say nothing.

    The primary button on the screen already says "Create the tender", and a
    panel telling somebody that the thing they are about to do is the thing
    they are about to do is noise. The hint exists for the message the router
    called an enquiry, or could not call anything.
  */
  if (facts.classifiedAs === "tender") return { show: false, score: 0, signals: [] };

  const signals: TenderSignal[] = [];

  if (subjectNamesAProcedure(facts.subject)) signals.push("procedureNamed");

  if (facts.attachments.some((file) => file.looksLike === "tender_dossier")) {
    signals.push("dossierAttached");
  }

  if (facts.attachments.some((file) => looksLikeArchive(file.filename, file.contentType))) {
    signals.push("archive");
  }

  if (facts.attachments.length >= MANY_FILES) signals.push("manyFiles");

  const score = signals.reduce((sum, signal) => sum + WEIGHTS[signal], 0);

  return { show: score >= TENDER_HINT_FLOOR, score, signals };
}
