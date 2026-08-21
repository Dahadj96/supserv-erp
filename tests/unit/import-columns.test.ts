import { describe, expect, it } from "vitest";
import { asAmount, asDate, asEmail, asLocale, asNif, asPhone } from "@/domain/import/clean";
import { guessImportable, mappedCount, proposeMapping } from "@/domain/import/columns";

/**
 * Screen 62. The headers below are taken from the kind of spreadsheet this
 * system is replacing: French, four years old, maintained by three people, with
 * a column called "Colonne H" that nobody remembers the purpose of.
 */
describe("screen 62 — reading somebody's real spreadsheet", () => {
  it("maps the columns of a clients sheet", () => {
    const headers = [
      "Client",
      "Nom commercial",
      "NIF",
      "RC",
      "Adresse",
      "Wilaya",
      "Email",
      "Téléphone",
      "Contact",
      "Fonction",
      "Colonne H",
    ];
    const mapping = proposeMapping(headers, "party");

    expect(mapping.Client).toBe("legalName");
    expect(mapping["Nom commercial"]).toBe("tradeName");
    expect(mapping.NIF).toBe("nif");
    expect(mapping.RC).toBe("rc");
    expect(mapping.Adresse).toBe("address");
    expect(mapping.Contact).toBe("contactName");
    expect(mapping.Fonction).toBe("contactJob");
    // "the rest are ignored" — named, not silently dropped.
    expect(mapping["Colonne H"]).toBeNull();

    expect(mappedCount(mapping)).toEqual({ mapped: 10, total: 11 });
  });

  it("lets the more specific heading win", () => {
    // "Nom" is inside "Nom commercial". Mapping both to legalName would put a
    // trade name where the raison sociale belongs, and it would print on an
    // invoice.
    const mapping = proposeMapping(["Nom commercial", "Nom"], "party");
    expect(mapping["Nom commercial"]).toBe("tradeName");
    expect(mapping.Nom).toBe("legalName");
  });

  it("never maps two columns to the same field", () => {
    const mapping = proposeMapping(["Client", "Société", "Raison sociale"], "party");
    const used = Object.values(mapping).filter((v) => v === "legalName");
    expect(used).toHaveLength(1);
  });

  it("tells a staff list from a clients list", () => {
    expect(guessImportable(["Nom et prénom", "Métier", "Wilaya"])).toBe("person");
    expect(guessImportable(["Client", "NIF", "Adresse"])).toBe("party");
  });

  it("reads dates in whichever of the three formats they were typed", () => {
    // Day first — this is an Algerian office, 03/12 is the third of December.
    expect(asDate("03/12/2026")?.toISOString().slice(0, 10)).toBe("2026-12-03");
    expect(asDate("2026-03-12")?.toISOString().slice(0, 10)).toBe("2026-03-12");
    // An Excel serial number, which is what a date becomes when a sheet is
    // exported and re-imported.
    expect(asDate(46000)?.toISOString().slice(0, 10)).toBe("2025-12-09");
    expect(asDate("pas une date")).toBeNull();
  });

  it("converts amounts that were stored as text", () => {
    expect(asAmount("1 250 000,00 DA")).toBe(1_250_000);
    expect(asAmount("1,250,000.00")).toBe(1_250_000);
    expect(asAmount("45 000")).toBe(45_000);
    expect(asAmount("12,50")).toBe(12.5);
    expect(asAmount("néant")).toBeNull();
  });

  it("keeps a NIF only when it is a NIF", () => {
    // Fifteen digits — décret 05-468.
    expect(asNif("000116001234567")).toEqual({
      value: "000116001234567",
      wasPresent: true,
      valid: true,
    });
    // Present but wrong. Imported blank rather than stored wrong: a wrong NIF
    // passes the "has a NIF" check and fails at the tax office.
    expect(asNif("0001160012")).toEqual({ value: null, wasPresent: true, valid: false });
    expect(asNif("")).toEqual({ value: null, wasPresent: false, valid: false });
  });

  it("finds the address inside whatever somebody typed in the email column", () => {
    expect(asEmail("Contact: A.Himer@Urbacon-QA.com")).toBe("a.himer@urbacon-qa.com");
    expect(asEmail("pas d'email")).toBeNull();
  });

  it("keeps a phone number as it was written", () => {
    expect(asPhone("0X XX XX XX XX")).toBeNull();
    expect(asPhone("049 96 12 34")).toBe("049 96 12 34");
    expect(asPhone("—")).toBeNull();
  });

  it("reads the document language however it was spelled", () => {
    expect(asLocale("Français")).toBe("fr");
    expect(asLocale("FR")).toBe("fr");
    expect(asLocale("anglais")).toBe("en");
    expect(asLocale("arabe")).toBeNull();
  });
});
