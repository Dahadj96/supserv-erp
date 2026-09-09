import { describe, expect, it } from "vitest";
import { RULES } from "@/domain/intake/channels";
import {
  type HintAttachment,
  MANY_FILES,
  TENDER_HINT_FLOOR,
  type TenderHintFacts,
  tenderHint,
} from "@/domain/intake/tender-hint";

/**
 * Screen 02 — "this looks like a tender" (task 2.3).
 *
 * The point of these tests is the two halves of LAW 2. The hint has to FIRE on
 * a dossier that plainly is one — otherwise the signals go on being computed
 * and thrown away, which is the bug — and it has to stay quiet on ordinary
 * post, because a suggestion that appears on every message is one nobody reads
 * by the second day.
 */

const file = (over: Partial<HintAttachment> = {}): HintAttachment => ({
  filename: "note.pdf",
  contentType: "application/pdf",
  looksLike: "unknown",
  ...over,
});

const facts = (over: Partial<TenderHintFacts> = {}): TenderHintFacts => ({
  classifiedAs: "enquiry",
  subject: null,
  attachments: [],
  ...over,
});

describe("screen 02 — the tender suggestion", () => {
  it("fires on a real dossier: an appel d'offres with a zip and several files", () => {
    const hint = tenderHint(
      facts({
        subject: "Avis d'appel d'offres national restreint n° 12/2026",
        attachments: [
          file({ filename: "dossier.zip", contentType: "application/zip", looksLike: "unknown" }),
          file({ filename: "CCTP.pdf", looksLike: "tender_dossier" }),
          file({ filename: "BPU.xlsx" }),
          file({ filename: "lettre.pdf" }),
        ],
      }),
    );

    expect(hint.show).toBe(true);
    expect(hint.signals).toEqual(["procedureNamed", "dossierAttached", "archive", "manyFiles"]);
  });

  it("reads the subject through the same words the routing rule uses", () => {
    // Not a copy of the list: if somebody adds a word to the rule on screen 38,
    // the hint gains it too, and this test proves the two cannot drift apart.
    const words = RULES.find((rule) => rule.creates === "tender")?.matcher.subjectContains ?? [];
    expect(words.length).toBeGreaterThan(0);

    for (const word of words) {
      expect(tenderHint(facts({ subject: `Objet : ${word} n° 4` })).show, word).toBe(true);
    }
  });

  it("ignores accents and case, the way the router does", () => {
    // "appel d'offres" written without the apostrophe's accent, in capitals —
    // which is how an administration writes a subject line.
    expect(tenderHint(facts({ subject: "AVIS D'APPEL D'OFFRES" })).show).toBe(true);
  });

  it("fires on a dossier attachment alone, because the sender named it", () => {
    const hint = tenderHint(facts({ attachments: [file({ looksLike: "tender_dossier" })] }));
    expect(hint.show).toBe(true);
    expect(hint.signals).toEqual(["dossierAttached"]);
  });

  it("says nothing about an ordinary enquiry with one PDF", () => {
    const hint = tenderHint(
      facts({ subject: "Demande de cotation - 3 vannes", attachments: [file()] }),
    );
    expect(hint.show).toBe(false);
    expect(hint.signals).toEqual([]);
  });

  it("does not fire on an archive by itself", () => {
    // A supplier's photographs arrive zipped as often as a dossier does. One
    // weak signal is not a suggestion.
    const hint = tenderHint(
      facts({ attachments: [file({ filename: "photos.zip", contentType: "application/zip" })] }),
    );
    expect(hint.signals).toEqual(["archive"]);
    expect(hint.show).toBe(false);
    expect(hint.score).toBeLessThan(TENDER_HINT_FLOOR);
  });

  it("does not fire on a pile of attachments by itself", () => {
    const many = Array.from({ length: MANY_FILES + 2 }, (_, i) =>
      file({ filename: `photo-${i}.jpg`, contentType: "image/jpeg" }),
    );
    const hint = tenderHint(facts({ attachments: many }));
    expect(hint.signals).toEqual(["manyFiles"]);
    expect(hint.show).toBe(false);
  });

  it("fires when the two weak signals arrive together", () => {
    const attachments = [
      file({ filename: "pieces.zip", contentType: "application/zip" }),
      file({ filename: "a.pdf" }),
      file({ filename: "b.pdf" }),
      file({ filename: "c.pdf" }),
    ];
    expect(tenderHint(facts({ attachments })).show).toBe(true);
  });

  it("recognises an archive the sender typed no content type for", () => {
    // Half the mailbox declares application/octet-stream. `looksLikeArchive`
    // falls back to the extension, and this is why the hint uses it rather
    // than reading the declared type on its own.
    const hint = tenderHint(
      facts({
        subject: "Consultation",
        attachments: [file({ filename: "DOSSIER.ZIP", contentType: "application/octet-stream" })],
      }),
    );
    expect(hint.signals).toContain("archive");
  });

  it("stays quiet when the router already said tender", () => {
    // The primary button already says "Create the tender". Repeating it in a
    // panel above is noise, not a proposal.
    const hint = tenderHint(
      facts({
        classifiedAs: "tender",
        subject: "Avis d'appel d'offres",
        attachments: [file({ looksLike: "tender_dossier" })],
      }),
    );
    expect(hint.show).toBe(false);
    expect(hint.signals).toEqual([]);
  });

  it("still fires on a message the router could not classify at all", () => {
    // needsReview is where a real dossier lands when its subject is a reference
    // number and nothing else. That is the message this hint is most for.
    const hint = tenderHint(
      facts({
        classifiedAs: "needsReview",
        subject: "N/Réf : 2026-0114",
        attachments: [
          file({ filename: "dossier.zip", contentType: "application/zip" }),
          file({ filename: "CPS.pdf" }),
          file({ filename: "bordereau.pdf" }),
          file({ filename: "soumission.pdf" }),
        ],
      }),
    );
    expect(hint.show).toBe(true);
  });

  it("proposes and never decides — it returns a reading, and writes nothing", () => {
    // The whole guarantee in one assertion: the result is data. Reclassifying
    // is the person pressing the button, through the same action the select
    // box above it uses.
    const before = facts({ subject: "Consultation", attachments: [file()] });
    const snapshot = JSON.stringify(before);
    tenderHint(before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
