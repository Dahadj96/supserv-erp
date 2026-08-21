import { describe, expect, it } from "vitest";
import type { PageText } from "@/capture/ocr/text-layer";
import { highConfidence, proposeFields, readFrenchDateTime } from "@/domain/intake/extract";

/**
 * Screen 40. The wording below is taken from the shape of a real règlement de
 * consultation — French, articles numbered, "au plus tard le 02 septembre 2026
 * à 10 heures 00", which is how these documents say things and not how any
 * example in a parsing tutorial does.
 */
const page = (n: number, lines: string[]): PageText => ({
  page: n,
  lines,
  text: lines.join("\n"),
});

const RC: PageText[] = [
  page(1, [
    "ROYAUME — DIRECTION DE DISTRIBUTION D'ADRAR",
    "AVIS D'APPEL D'OFFRES NATIONAL N° 12/2026",
  ]),
  page(4, [
    "ARTICLE 7 — PRÉSENTATION DES OFFRES",
    "Les offres doivent être déposées au bureau des marchés de la Direction de Distribution d'Adrar au plus tard le 02 septembre 2026 à 10 heures 00.",
    "L'ouverture des plis aura lieu le même jour à 14 heures 00 en séance publique.",
  ]),
  page(5, [
    "ARTICLE 8 — CAUTION DE SOUMISSION",
    "Le soumissionnaire doit joindre une caution de soumission d'un montant de 84 200,00 DA représentant 1% du montant de l'offre.",
  ]),
  page(6, [
    "ARTICLE 11 — DÉLAI DE VALIDITÉ DES OFFRES",
    "Le délai de validité des offres est fixé à 90 jours à compter de la date de dépôt.",
  ]),
];

describe("screen 40 — what we read, and where we read it", () => {
  it("reads a French date the way the document writes it", () => {
    const d = readFrenchDateTime("au plus tard le 02 septembre 2026 à 10 heures 00");
    expect(d?.iso).toBe("2026-09-02T10:00:00");
    expect(d?.display).toBe("02/09/2026 · 10:00");
  });

  it("reads a numeric date day-first", () => {
    expect(readFrenchDateTime("le 02/09/2026 à 10h00")?.iso).toBe("2026-09-02T10:00:00");
  });

  it("returns nothing rather than a guess when there is no date", () => {
    expect(readFrenchDateTime("les offres seront déposées ultérieurement")).toBeNull();
  });

  it("finds the submission deadline and says which page it is on", () => {
    const fields = proposeFields(RC);
    const deadline = fields.find((f) => f.key === "submissionDeadline");

    expect(deadline?.value).toBe("2026-09-02T10:00:00");
    expect(deadline?.citation.page).toBe(4);
    expect(deadline?.citation.article, "the article heading above it").toBe("article 7");
    expect(deadline?.citation.quote).toContain("au plus tard le 02 septembre 2026");
  });

  it("tells the opening session apart from the deadline", () => {
    const opening = proposeFields(RC).find((f) => f.key === "openingSession");
    // Same day, four hours later. Two dates on one page that a keyword search
    // would happily confuse.
    expect(opening?.value).toBe("2026-09-02T14:00:00");
    expect(opening?.citation.quote).toContain("ouverture des plis");
  });

  it("reads the caution de soumission as both an amount and a percentage", () => {
    const bond = proposeFields(RC).find((f) => f.key === "bidBond");
    expect(bond?.value).toContain("84 200,00 DZD");
    expect(bond?.value).toContain("(1%)");
    expect(bond?.citation.page).toBe(5);
  });

  it("reads the validity period", () => {
    const validity = proposeFields(RC).find((f) => f.key === "offerValidity");
    expect(validity?.value).toBe("90 jours");
    expect(validity?.citation.article).toBe("article 11");
  });

  it("proposes one value per field, not six", () => {
    const fields = proposeFields([...RC, ...RC]);
    const deadlines = fields.filter((f) => f.key === "submissionDeadline");
    // A person is asked to confirm a value, not to choose between duplicates.
    expect(deadlines).toHaveLength(1);
  });

  it("loses confidence when the same cue appears more than once", () => {
    const once = proposeFields(RC).find((f) => f.key === "submissionDeadline");
    const twice = proposeFields([
      ...RC,
      page(9, [
        "ARTICLE 19 — REPORT",
        "La date limite de dépôt des offres est reportée au 15 septembre 2026 à 10 heures 00.",
      ]),
    ]).find((f) => f.key === "submissionDeadline");

    expect(twice?.confidence).toBeLessThan(once?.confidence ?? 1);
    expect(twice?.caveat, "a person settles this in a second").toBe("severalCandidates");
  });

  it("loses confidence on hedged wording", () => {
    const hedged = proposeFields([
      page(3, [
        "ARTICLE 5",
        "Le délai de validité des offres est fixé à 90 jours, sauf prorogation décidée par le service contractant.",
      ]),
    ]).find((f) => f.key === "offerValidity");

    expect(hedged?.caveat).toBe("hedged");
    expect(hedged?.confidence).toBeLessThan(0.8);
  });

  it("proposes nothing at all from a document that says nothing", () => {
    const nothing = proposeFields([
      page(1, ["Bonjour,", "Veuillez trouver ci-joint notre catalogue 2026.", "Cordialement."]),
    ]);
    // Silence is the correct output. An empty review screen is honest; six
    // invented fields with citations pointing at a greeting are not.
    expect(nothing).toEqual([]);
  });

  it("holds back anything with a caveat from Confirm all high confidence", () => {
    const fields = proposeFields([
      ...RC,
      page(9, ["ARTICLE 19", "La date limite de dépôt est reportée au 15 septembre 2026."]),
    ]);
    const auto = highConfidence(fields, 0.8);

    expect(auto.map((f) => f.key)).not.toContain("submissionDeadline");
    expect(auto.map((f) => f.key)).toContain("offerValidity");
  });

  it("never cites a quotation longer than a person will read", () => {
    const long =
      "Les offres doivent être déposées au plus tard le 02 septembre 2026 à 10 heures 00 ".repeat(
        6,
      );
    const field = proposeFields([page(2, ["ARTICLE 7", long])])[0];
    expect(field?.citation.quote.length).toBeLessThanOrEqual(240);
  });
});
