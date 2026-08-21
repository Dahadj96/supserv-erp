import { describe, expect, it } from "vitest";
import { RULES } from "@/domain/intake/channels";
import { AUTO_CREATE_FLOOR } from "@/domain/intake/rails";
import {
  bodyLooksLikeItHasAPrice,
  type RoutableMessage,
  type RoutingRule,
  route,
} from "@/domain/intake/routing";

/**
 * Screen 38 — the six rules, applied in order, first match wins.
 *
 * These tests run against the REAL seeded rules rather than fixtures invented
 * for the test. If somebody reorders the rules on the settings screen and
 * "Anything else" ends up second, this file is what notices.
 */
const rules: RoutingRule[] = RULES.map((r, i) => ({
  ...r,
  id: `rule-${i + 1}`,
  enabled: true,
}));

const message = (over: Partial<RoutableMessage> = {}): RoutableMessage => ({
  subject: null,
  bodyText: null,
  senderIsKnownCompany: false,
  senderIsKnownSupplier: false,
  attachmentKinds: [],
  ...over,
});

describe("screen 38 — routing", () => {
  it("sends a CV from somebody we do not know to Candidates", () => {
    const d = route(message({ attachmentKinds: ["cv"], subject: "Candidature soudeur" }), rules);
    expect(d.creates).toBe("candidate");
    expect(d.mode, "two strong signals — this is what auto is for").toBe("auto");
  });

  it("does not treat a CV from a client as a job application", () => {
    // A client sending a CV is sending you their engineer's qualifications for
    // a bid, not applying for work.
    const d = route(
      message({ attachmentKinds: ["cv"], senderIsKnownCompany: true, subject: "Moyens humains" }),
      rules,
    );
    expect(d.creates).not.toBe("candidate");
  });

  it("recognises an enquiry however it is spelled", () => {
    for (const subject of [
      "PR 3000116322 - fourniture",
      "RFQ for audio equipment",
      "Demande de cotation urgente",
      "DEMANDE DE COTATION",
      "demande de cotation",
    ]) {
      expect(route(message({ subject }), rules).creates, subject).toBe("enquiry");
    }
  });

  it("tells a tender apart from an enquiry", () => {
    const tender = route(message({ subject: "Avis d'appel d'offres national" }), rules);
    expect(tender.creates).toBe("tender");

    const enquiry = route(message({ subject: "RFQ - 12 haut-parleurs" }), rules);
    expect(enquiry.creates).toBe("enquiry");
  });

  it("reads a price in the body the way a person would", () => {
    expect(bodyLooksLikeItHasAPrice("Prix unitaire 1 250 000,00 DA")).toBe(true);
    expect(bodyLooksLikeItHasAPrice("45.000 DZD HT")).toBe(true);
    expect(bodyLooksLikeItHasAPrice("€ 12 300")).toBe(true);
    expect(bodyLooksLikeItHasAPrice("Bonjour, ci-joint notre offre.")).toBe(false);
    // A reference number is not a price.
    expect(bodyLooksLikeItHasAPrice("Votre PR 3000116322")).toBe(false);
  });

  it("routes a priced email from a known supplier to a supplier quote", () => {
    const d = route(
      message({
        senderIsKnownSupplier: true,
        senderIsKnownCompany: true,
        bodyText: "Notre meilleure offre: 845 000,00 DA HT",
        subject: "Re: votre demande",
      }),
      rules,
    );
    expect(d.creates).toBe("supplierQuote");
    expect(d.mode).toBe("auto");
  });

  it("only suggests a payment match, never makes one", () => {
    const d = route(message({ subject: "Virement effectué facture SUP/2026/0042" }), rules);
    expect(d.creates).toBe("payment");
    // Being wrong about money costs a phone call to a client. Screen 38 marks
    // this rule Suggest, and no confidence score may promote it.
    expect(d.mode).toBe("suggest");
  });

  it("first match wins, in the order the screen lists them", () => {
    // This one satisfies rule 2 AND rule 5. Rule 2 is higher, so it is an
    // enquiry — which is right: a client asking for a price on an invoice
    // reference is still a client asking for a price.
    const d = route(message({ subject: "RFQ suite à votre facture" }), rules);
    expect(d.creates).toBe("enquiry");
  });

  it("sends anything else to Needs review, and creates nothing", () => {
    const d = route(message({ subject: "Bonne année à toute l'équipe" }), rules);
    expect(d.creates).toBe("needsReview");
    expect(d.mode).toBe("manual");
  });

  it("never auto-creates below the confidence floor", () => {
    for (const rule of rules) {
      const d = route(
        message({
          subject: "Demande de cotation",
          attachmentKinds: ["cv"],
          senderIsKnownSupplier: true,
          bodyText: "1000 DA",
        }),
        [{ ...rule, mode: "auto" }],
      );
      if (d.mode === "auto") {
        expect(d.confidence, `${rule.labelKey} auto-created on a guess`).toBeGreaterThanOrEqual(
          AUTO_CREATE_FLOOR,
        );
      }
    }
  });

  it("downgrades rather than discards when it is not sure enough", () => {
    // A rule that fires on one weak signal alone.
    const weak: RoutingRule = {
      id: "weak",
      position: 1,
      matcher: { bodyContains: ["peut-être"] },
      creates: "enquiry",
      mode: "auto",
      enabled: true,
      labelKey: "x",
      actionKey: "y",
    };
    const d = route(message({ bodyText: "peut-être" }), [weak]);
    expect(d.downgraded).toBe(true);
    expect(d.mode).toBe("suggest");
    // Still routed. A 60% guess is the best lead a person has; it just does not
    // get to write to the database on its own.
    expect(d.creates).toBe("enquiry");
  });

  it("says which conditions fired, so a person can see why", () => {
    const d = route(message({ senderIsKnownSupplier: true, bodyText: "Total 320 000 DA" }), rules);
    expect(d.matched).toContain("senderIsKnownSupplier");
    expect(d.matched).toContain("bodyContainsPrice");
  });

  it("falls through to Needs review if every rule is disabled", () => {
    const d = route(
      message({ subject: "RFQ" }),
      rules.map((r) => ({ ...r, enabled: false })),
    );
    expect(d.creates).toBe("needsReview");
    expect(d.rule).toBeNull();
  });
});
