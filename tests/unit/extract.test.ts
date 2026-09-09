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

  /*
    TASK 2.4a — the wording of a real private consultation, not an invented one.

    The three lines below are verbatim from
    `B_RFQ-10023604-26_Fourniture de Bureau_Instructions aux Soumissionnaires.pdf`,
    one of the six readable files of the RFQ actually sitting in this database.
    It was read successfully in 1.11 and proposed nothing at all, and this is
    the sentence that says why: the fact is there, stated as an obligation on
    the bidder, and no cue in this file named the verb it is stated with.
  */
  it("reads an offer validity a private consultation states rather than labels", () => {
    const fields = proposeFields([
      page(4, [
        "1.6.15 Il est entendu que le SOUMISSIONNAIRE feraune offre la plus adéquation avec la réalité.",
        "1.6.18 L’offre doit rester valable pour une période minimale de 180 jours calendaires à partir de la date",
        "1.6.19 Tous les SOUMISSIONNAIRES doivent soumettre dans le dossier de l’offre technique le projet",
      ]),
    ]);

    const validity = fields.find((f) => f.key === "offerValidity");
    expect(validity?.value).toBe("180 jours");
    expect(validity?.citation.page).toBe(4);
    expect(validity?.citation.quote).toContain("rester valable");
  });

  it("still says nothing about a document that only discusses the deadline", () => {
    /*
      Also verbatim from that file, page 2. The cue "date limite de depot" IS
      present — and there is no date on the line, in the lines around it, or
      anywhere in the six files. The document REFERS to a deadline it never
      states; the deadline for this RFQ came in the covering email.

      A reader that answered here would be inventing one, which is the failure
      LAW 2 exists to prevent. Nothing proposed is the correct answer.
    */
    const fields = proposeFields([
      page(2, [
        "LE SOUMISSIONNAIRE devrait confirmer son engagement pour respecter la date limite de depot de",
        "l’offre et spécifier le nom, numéro de cellulaire, adresse e-mail de la personne à contacter par le CLIENT",
      ]),
    ]);
    expect(fields.map((f) => f.key)).not.toContain("submissionDeadline");
  });

  it("does not let the new cue fire on a delivery time", () => {
    // "15 jours" next to a delivery clause is not an offer validity, and the
    // widened cue must not turn every duration in a contract into one.
    const fields = proposeFields([
      page(3, [
        "5 DELAI DE LIVRAISON",
        "formulée par le client, Ce délai devra être inférieur ou égal à 15 jours",
      ]),
    ]);
    expect(fields).toHaveLength(0);
  });

  /*
    TASK 2.4b — the label on one line and the fact on the next.

    Verbatim from page 12 of `F_RFQ-…_Projet de Contrat.pdf`. Line 27 carries
    the cue and ends mid-phrase — "…paiera au CLIENT des pénalités de" — and
    line 28 opens with "retard comme suit : 1 %". Before 2.4b this document
    proposed nothing at all, twice over: the article heading has no rate under
    it within reach, and the clause that has the rate had no cue in its own
    sentence.
  */
  const CONTRACT = page(12, [
    "ARTICLE 13 – PENALITES DE RETARD",
    "13.1 Le CLIENT Précisera dans le BON DE COMMANDE la Date de livraison pour toute livraison totale ou",
    "partielle des BIENS. Le FOURNISSEUR accepte d’effectuer la livraison de tels BIENS avant ou à la",
    "13.3 En cas de retard dans la livraison des BIENS, Le FOURNISSEUR paiera au CLIENT des pénalités de",
    "retard comme suit : 1 % par jour du montant total du bon de commande, jusqu’à un maximum",
    "cumulé de dix pourcent (10%) du montant total du CONTRAT.",
  ]);

  it("reads a value from the line under the cue that names it", () => {
    const penalty = proposeFields([CONTRACT]).find((f) => f.key === "latePenalty");

    expect(penalty?.value).toBe("1% par jour");
    expect(penalty?.caveat).toBe("readBelowCue");
  });

  it("cites the line the value is on, not the line the cue is on", () => {
    // A citation pointing at a heading is a field nobody can check, which is
    // the one thing screen 40 may not produce.
    const penalty = proposeFields([CONTRACT]).find((f) => f.key === "latePenalty");

    expect(penalty?.citation.quote).toContain("1 % par jour");
    expect(penalty?.citation.quote).not.toContain("ARTICLE 13");
    // And the article is still named, because articleAbove walks up the page.
    expect(penalty?.citation.article).toBe("article 13");
  });

  it("trusts a value read below a cue less than one read beside it", () => {
    const below = proposeFields([CONTRACT]).find((f) => f.key === "latePenalty");
    const beside = proposeFields([
      page(12, [
        "ARTICLE 13",
        "Les pénalités de retard sont de 1 % par jour du montant total du bon de commande.",
      ]),
    ]).find((f) => f.key === "latePenalty");

    expect(below?.confidence).toBeLessThan(beside?.confidence ?? 1);
    expect(beside?.caveat).toBeNull();
  });

  it("never reads below a cue that is a table of contents entry", () => {
    /*
      The contents page carries every heading in the document, and the line
      under one heading there is the NEXT heading. Verbatim from page 3 of the
      same file — dot leaders and a page number.
    */
    const fields = proposeFields([
      page(3, [
        "ARTICLE 13 – PENALITES DE RETARD ....................................................................... 12",
        "ARTICLE 14 - GARANTIE ................................................................................................. 12",
        "ARTICLE 15 – NOTIFICATION ........................................................................................ 13",
      ]),
    ]);
    expect(fields).toHaveLength(0);
  });

  it("does not call a heading and the clause under it two candidates", () => {
    /*
      The commonest layout in the RC fixture above: the article heading names
      the field and the clause under it states the value and names it again.
      The window reaches that clause from the heading and the clause finds
      itself — one reading arrived at twice. Counting it as two would leave
      "the document says this more than once" permanently on screen 40, which
      is how a caveat stops meaning anything.
    */
    const validity = proposeFields(RC).find((f) => f.key === "offerValidity");

    expect(validity?.value).toBe("90 jours");
    expect(validity?.caveat).toBeNull();
    expect(validity?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("does not reach past the window into the next article", () => {
    // Two lines. A heading followed by three lines of prose and then an
    // unrelated number must stay unread — a window wide enough to span a
    // paragraph is a guess with a citation attached.
    const fields = proposeFields([
      page(5, [
        "ARTICLE 11 — DÉLAI DE VALIDITÉ DES OFFRES",
        "Le présent article précise les obligations du soumissionnaire quant à son offre.",
        "Il est rappelé que toute offre engage son auteur.",
        "ARTICLE 12 — DÉLAI DE LIVRAISON",
        "La livraison intervient dans un délai de 15 jours.",
      ]),
    ]);
    expect(fields.map((f) => f.key)).not.toContain("offerValidity");
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
