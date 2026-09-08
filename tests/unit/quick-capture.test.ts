import { describe, expect, it } from "vitest";
import { companyNameFromEmail } from "@/capture/quick";
import {
  classify,
  compose,
  filingPath,
  proposeFollowUp,
  type Resolved,
  readAmount,
  sight,
  writeSummary,
} from "@/capture/reading";

/** The email the mockup for screen 61 actually shows in the box. */
const PASTED_EMAIL = `De : compta@urbacon-qa.com
Objet : RE: facture SUP/2026/0034 — en cours de règlement

Bonjour,

Nous confirmons que la facture SUP/2026/0034 a été transmise au service
financier. Le règlement devrait intervenir avant la fin du mois.

Cordialement,
Service comptabilité — URBACON`;

const URBACON: Resolved = {
  party: { id: "party-1", name: "URBACON", isClient: true },
  document: {
    id: "doc-1",
    number: "SUP/2026/0034",
    kind: "invoice",
    totalIncl: "5640000",
    currency: "DZD",
  },
};

const NOTHING: Resolved = { party: null, document: null };

describe("what the text plainly contains", () => {
  it("finds the reference, the sender and the line each came from", () => {
    const seen = sight(PASTED_EMAIL);
    const reference = seen.find((s) => s.kind === "reference");
    expect(reference?.value).toBe("SUP/2026/0034");
    // The quote is what makes the proposal checkable by eye.
    expect(reference?.quote).toContain("Objet");
    expect(seen.find((s) => s.kind === "email")?.value).toBe("compta@urbacon-qa.com");
  });

  it("reads Algerian and French amount spellings the same way", () => {
    expect(readAmount("5 640 000")).toBe("5640000");
    expect(readAmount("5.640.000")).toBe("5640000");
    expect(readAmount("5 640 000,50")).toBe("5640000.50");
    expect(readAmount("douze")).toBeNull();
  });

  it("does not report the same sighting twice", () => {
    // The reference appears in the subject AND the body of the pasted email.
    const references = sight(PASTED_EMAIL).filter((s) => s.kind === "reference");
    expect(references).toHaveLength(1);
  });
});

describe("what this is", () => {
  it("reads the payment update", () => {
    const { shape, confidence } = classify(PASTED_EMAIL, "email", sight(PASTED_EMAIL));
    expect(shape).toBe("paymentUpdate");
    expect(confidence).toBeGreaterThan(0.8);
  });

  it("believes the button over the words", () => {
    // Somebody pressed "Phone note" and then typed the word "règlement" in it.
    // What they pressed is a fact; what they typed is a hint.
    const { shape, confidence } = classify("règlement promis pour jeudi", "phone", []);
    expect(shape).toBe("phoneNote");
    expect(confidence).toBe(1);
  });

  it("says it could not tell rather than picking something", () => {
    expect(classify("Bonjour, à bientôt.", "typed", []).shape).toBe("unknown");
  });
});

const AUGUST = new Date(Date.UTC(2026, 7, 19));

function reading(resolved: Resolved, text = PASTED_EMAIL) {
  return compose({
    mode: "email",
    text,
    sightings: sight(text),
    resolved,
    today: AUGUST,
  });
}

describe("the six proposals", () => {
  it("reproduces the card the mockup draws", () => {
    const r = reading(URBACON);
    const by = (key: string) => r.fields.find((f) => f.key === key);

    expect(by("this")?.labelKey).toBe("shape.paymentUpdate");
    expect(by("from")?.state).toBe("matched");
    expect(by("from")?.values).toEqual(["URBACON"]);
    expect(by("about")?.values).toEqual(["SUP/2026/0034"]);
    // The amount is handed over unformatted. Grouping is a locale decision and
    // this module does not know which language the screen is in.
    expect(by("about")?.money).toEqual({ amount: "5640000", currency: "DZD" });
    expect(by("filedTo")?.state).toBe("auto");
    expect(by("filedTo")?.values).toEqual(["Clients", "URBACON", "2026", "Correspondance"]);
    expect(by("followUp")?.values).toEqual(["2026-08-31"]);
  });

  it("shows an unplaced address instead of pretending nobody wrote", () => {
    const r = reading(NOTHING);
    const from = r.fields.find((f) => f.key === "from");
    expect(from?.state).toBe("unknown");
    expect(from?.values).toEqual(["compta@urbacon-qa.com"]);
    expect(from?.caveatKey).toBe("addressNotOnAnyCompany");
  });

  it("flags a reference that matches no document", () => {
    const r = reading({ party: URBACON.party, document: null });
    const about = r.fields.find((f) => f.key === "about");
    expect(about?.state).toBe("unknown");
    expect(about?.caveatKey).toBe("noDocumentWithThatNumber");
  });

  it("notices when the amount in the email is not the amount on the invoice", () => {
    const part = PASTED_EMAIL.replace(
      "Le règlement devrait",
      "Un acompte de 2 000 000 DA a été viré. Le solde devrait",
    );
    const about = reading(URBACON, part).fields.find((f) => f.key === "about");
    expect(about?.state).toBe("matched");
    expect(about?.caveatKey).toBe("amountDiffersFromDocument");
  });

  it("does not cry about two centimes of rounding", () => {
    const rounded = PASTED_EMAIL.replace("règlement devrait", "montant de 5 640 000,00 DA devrait");
    expect(reading(URBACON, rounded).fields.find((f) => f.key === "about")?.caveatKey).toBeNull();
  });

  it("admits that nothing files to SharePoint yet", () => {
    // The badge says `auto` because the path is arithmetic. The caveat says no
    // folder was touched. Both are true and the screen prints both.
    expect(reading(URBACON).fields.find((f) => f.key === "filedTo")?.caveatKey).toBe(
      "filingNotConnected",
    );
  });

  it("admits that nothing will remind you", () => {
    expect(reading(URBACON).fields.find((f) => f.key === "followUp")?.caveatKey).toBe(
      "remindersNotBuiltYet",
    );
  });
});

describe("nothing is created until you press the button", () => {
  it("derives 'what it changes' from the write plan, never from a sentence", () => {
    const r = reading(URBACON);
    const changes = r.fields.find((f) => f.key === "changes");

    // The plan is one row. The sentence says so. If somebody adds an insert to
    // save() without adding it here, these two stop agreeing.
    expect(writeSummary(r)).toEqual(["intake_message"]);
    expect(changes?.labelKey).toBe("changes.creates");
    expect(changes?.state).toBe("suggested");
  });

  it("only says 'safe' when the plan is genuinely empty", () => {
    const r = reading(URBACON, "ok");
    expect(r.tooThin).toBe(true);
    expect(r.writes).toEqual([]);
    const changes = r.fields.find((f) => f.key === "changes");
    expect(changes?.labelKey).toBe("changes.nothing");
    expect(changes?.state).toBe("safe");
  });

  it("never plans to write a payment, a deal or a document", () => {
    // Screen 61 captures. It does not settle invoices. The day somebody adds
    // `payment` to this plan is the day this test asks them to think about it.
    for (const resolved of [URBACON, NOTHING]) {
      expect(writeSummary(reading(resolved))).toEqual(["intake_message"]);
    }
  });

  it("reads the same way twice", () => {
    expect(reading(URBACON)).toEqual(reading(URBACON));
  });
});

describe("the follow-up is the date somebody committed to", () => {
  it("proposes the end of the month, because that is what was promised", () => {
    expect(proposeFollowUp({ shape: "paymentUpdate", resolved: URBACON, today: AUGUST })).toBe(
      "2026-08-31",
    );
  });

  it("proposes nothing when there is nothing to chase", () => {
    expect(proposeFollowUp({ shape: "priceList", resolved: URBACON, today: AUGUST })).toBeNull();
    expect(
      proposeFollowUp({ shape: "paymentUpdate", resolved: NOTHING, today: AUGUST }),
    ).toBeNull();
  });
});

describe("folder names are not translated", () => {
  it("files a client and a supplier in different trees", () => {
    expect(
      filingPath({ party: { name: "URBACON", isClient: true }, shape: "enquiry", year: 2026 }),
    ).toEqual(["Clients", "URBACON", "2026", "Correspondance"]);
    expect(
      filingPath({ party: { name: "SARPI", isClient: false }, shape: "priceList", year: 2026 }),
    ).toEqual(["Fournisseurs", "SARPI", "2026", "Prix"]);
  });

  it("has nowhere to file something from nobody", () => {
    expect(filingPath({ party: null, shape: "enquiry", year: 2026 })).toBeNull();
  });
});

/**
 * The company name suggested from an address, for a person to correct.
 *
 * Screen 02's dead end was an RFQ from a sender attached to no company: the
 * button was grey, the reason was a tooltip, and the step it pointed at did not
 * exist. The screen asks for the name now, and asking with the box already
 * filled in is the difference between one keystroke and retyping what is on
 * the screen in front of you.
 *
 * It is a suggestion and never a record. `resolveSender` above still refuses to
 * guess WHICH company an address belongs to — this only proposes a word.
 */
describe("a company name suggested from an address", () => {
  it("takes the domain, because that is the company and the local part is a person", () => {
    expect(companyNameFromEmail("commercial@touatgaz.dz")).toBe("TOUATGAZ");
    expect(companyNameFromEmail("m.belkacem@touatgaz.dz")).toBe("TOUATGAZ");
    expect(companyNameFromEmail("Achats@Urbacon.COM.dz")).toBe("URBACON");
  });

  it("suggests nothing from a free mailbox — gmail.com is not a company", () => {
    expect(companyNameFromEmail("nedn40527@gmail.com")).toBeNull();
    expect(companyNameFromEmail("someone@yahoo.fr")).toBeNull();
    expect(companyNameFromEmail("someone@outlook.com")).toBeNull();
  });

  it("suggests nothing rather than something useless", () => {
    expect(companyNameFromEmail(null)).toBeNull();
    expect(companyNameFromEmail("")).toBeNull();
    expect(companyNameFromEmail("no-at-sign")).toBeNull();
    // A single letter is not a name anybody would keep.
    expect(companyNameFromEmail("a@x.dz")).toBeNull();
  });
});
