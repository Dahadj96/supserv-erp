import { describe, expect, it } from "vitest";
import { checklist, summarise } from "@/documents/checklist";
import type { Finding } from "@/documents/compliance";
import type { RenderedDocument } from "@/documents/engine";

/**
 * Screen 18. The thing worth testing here is not the ordering — it is the
 * difference between "this failed" and "we do not have this". A checklist that
 * blurs the two either invents a law or hides a refusal.
 */

const DECREE = {
  authority: "décret exécutif 05-468",
  confirmedBy: "décret exécutif 05-468",
  confirmedOn: "2005-12-10",
  fixRoute: "/companies",
};

function finding(code: string, severity: Finding["severity"], extra: Partial<Finding> = {}) {
  return {
    code,
    severity,
    authority: null,
    confirmedBy: null,
    confirmedOn: null,
    fixRoute: null,
    ...extra,
  } satisfies Finding;
}

function doc(over: Partial<RenderedDocument> = {}): RenderedDocument {
  return {
    number: null,
    issued: false,
    kind: "invoice",
    locale: "fr",
    issuedOn: "19/08/2026",
    dateline: "Adrar, le 19 août 2026",
    settlement: null,
    company: {
      legalName: "SARL SUPSERV",
      address: "Adrar",
      rc: "01/00-0123456 B 09",
      nif: "001901012345678",
      nis: "001901012345679",
      ai: "01234567890",
      logoPath: "logo.png",
      phone: null,
      email: null,
    },
    counterparty: {
      legalName: "SADEG",
      address: "Zone industrielle, Adrar",
      nif: "099101019876543",
      nis: "099101019876544",
      rc: "01/00-0987654 B 11",
    },
    bank: null,
    lines: [],
    totals: [],
    amountInWords: "deux mille dinars algériens",
    situation: null,
    amendment: null,
    findings: [],
    template: "SUPSERV invoice — FR v1",
    ...over,
  };
}

const row = (rows: ReturnType<typeof checklist>, key: string) => rows.find((r) => r.key === key);

describe("the before-issuing checklist", () => {
  it("puts the client's identifiers first and the document number last", () => {
    const rows = checklist(doc());
    expect(rows[0]?.key).toBe("clientNif");
    expect(rows.at(-1)?.key).toBe("documentNumber");
  });

  it("reports what we hold, not only what is wrong", () => {
    const rows = checklist(doc());
    expect(rows.every((r) => r.state === "pass" || r.state === "note")).toBe(true);
    expect(row(rows, "clientNis")?.value).toBe("099101019876544");
    expect(row(rows, "amountInWords")?.value).toBe("deux mille dinars algériens");
  });

  it("says a missing fact is not recorded — it does not call it required", () => {
    // Nobody has confirmed that the buyer's NIS is obligatory on an invoice, so
    // the checklist must not imply it. This is LAW 2 as a unit test.
    const rows = checklist(doc({ counterparty: { ...doc().counterparty, nis: null } }));
    const nis = row(rows, "clientNis");

    expect(nis?.state).toBe("note");
    expect(nis?.noteKey).toBe("notRecorded");
    expect(nis?.authority, "a fact has no authority to cite").toBeNull();
    expect(summarise(rows).warnings, "a blank field is not a warning").toBe(0);
    expect(summarise(rows).canIssue).toBe(true);
  });

  it("blocks on a confirmed rule and carries whose confirmation it was", () => {
    const rows = checklist(
      doc({ findings: [finding("invoice.clientNifMissing", "block", DECREE)] }),
    );
    const nif = row(rows, "clientNif");

    expect(nif?.state).toBe("block");
    expect(nif?.confirmedBy).toBe("décret exécutif 05-468");
    expect(nif?.confirmedOn).toBe("2005-12-10");
    expect(nif?.fixRoute).toBe("/companies");
    expect(nif?.value, "a failing rule shows the reason, not a value").toBeNull();
    expect(summarise(rows)).toEqual({ blockers: 1, warnings: 0, canIssue: false });
  });

  it("only warns while nobody has confirmed the rule", () => {
    const rows = checklist(
      doc({
        findings: [finding("invoice.stampDutyThreshold", "warn", { authority: "code du timbre" })],
      }),
    );

    expect(row(rows, "invoice.stampDutyThreshold")?.state).toBe("warn");
    expect(summarise(rows)).toEqual({ blockers: 0, warnings: 1, canIssue: true });
  });

  it("shows a rule that passed as passed, with the value it checked", () => {
    const rows = checklist(
      doc({ findings: [finding("invoice.clientNifMissing", "pass", DECREE)] }),
    );
    const nif = row(rows, "clientNif");

    expect(nif?.state).toBe("pass");
    expect(nif?.value).toBe("099101019876543");
  });

  it("appends a rule it has never heard of rather than dropping it", () => {
    const rows = checklist(doc({ findings: [finding("invoice.somethingNew", "warn")] }));
    expect(row(rows, "invoice.somethingNew")?.state).toBe("warn");
  });

  it("says the number is reserved on issue, and shows it once it is", () => {
    expect(row(checklist(doc()), "documentNumber")?.noteKey).toBe("numberOnIssue");

    const issued = checklist(doc({ number: "SUP/2026/0042" }));
    expect(row(issued, "documentNumber")?.state).toBe("pass");
    expect(row(issued, "documentNumber")?.value).toBe("SUP/2026/0042");
  });

  it("reports our own four identifiers as one row, and blocks when one is gone", () => {
    const complete = checklist(
      doc({ findings: [finding("invoice.companyIdentityIncomplete", "pass")] }),
    );
    expect(row(complete, "ourIdentifiers")?.value).toContain("01234567890");

    const broken = checklist(
      doc({
        company: { ...doc().company, ai: "" },
        findings: [
          finding("invoice.companyIdentityIncomplete", "block", {
            ...DECREE,
            fixRoute: "/setup/identity",
          }),
        ],
      }),
    );
    expect(row(broken, "ourIdentifiers")?.state).toBe("block");
    expect(row(broken, "ourIdentifiers")?.fixRoute).toBe("/setup/identity");
  });
});
