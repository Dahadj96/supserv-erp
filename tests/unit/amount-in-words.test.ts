import { describe, expect, it } from "vitest";
import {
  amountInWords,
  englishNumberInWords,
  frenchNumberInWords,
} from "@/documents/amount-in-words";

/**
 * Screen 70 — the engine owns the amount in words.
 *
 * This is the line a client reads when the figures are disputed, so the tests
 * below are the French agreement rules rather than a handful of round numbers.
 * Every one of them is a plural that would go out on paper for a year before
 * anybody noticed it was wrong.
 */
describe("amount in words — French", () => {
  it("counts in twenties, the way French does", () => {
    expect(frenchNumberInWords(70)).toBe("soixante-dix");
    expect(frenchNumberInWords(71)).toBe("soixante et onze");
    expect(frenchNumberInWords(80)).toBe("quatre-vingts");
    expect(frenchNumberInWords(81)).toBe("quatre-vingt-un");
    expect(frenchNumberInWords(84)).toBe("quatre-vingt-quatre");
    expect(frenchNumberInWords(90)).toBe("quatre-vingt-dix");
    expect(frenchNumberInWords(91)).toBe("quatre-vingt-onze");
    expect(frenchNumberInWords(99)).toBe("quatre-vingt-dix-neuf");
  });

  it("puts 'et' before un and onze, and nowhere else", () => {
    expect(frenchNumberInWords(21)).toBe("vingt et un");
    expect(frenchNumberInWords(31)).toBe("trente et un");
    expect(frenchNumberInWords(22)).toBe("vingt-deux");
    // quatre-vingt-un takes no "et". This is the one everybody gets wrong.
    expect(frenchNumberInWords(81)).not.toContain(" et ");
  });

  it("gives cent its s only when nothing follows it", () => {
    expect(frenchNumberInWords(100)).toBe("cent");
    expect(frenchNumberInWords(200)).toBe("deux cents");
    expect(frenchNumberInWords(250)).toBe("deux cent cinquante");
    expect(frenchNumberInWords(101)).toBe("cent un");
    expect(frenchNumberInWords(180)).toBe("cent quatre-vingts");
  });

  it("never gives mille an s, and always gives millions one", () => {
    expect(frenchNumberInWords(1000)).toBe("mille");
    expect(frenchNumberInWords(2000)).toBe("deux mille");
    // The s dies before a multiplier: quatre-vingts dinars, quatre-vingt mille.
    expect(frenchNumberInWords(80_000)).toBe("quatre-vingt mille");
    expect(frenchNumberInWords(200_000)).toBe("deux cent mille");
    expect(frenchNumberInWords(80)).toBe("quatre-vingts");
    expect(frenchNumberInWords(1_000_000)).toBe("un million");
    expect(frenchNumberInWords(2_000_000)).toBe("deux millions");
    expect(frenchNumberInWords(2_000_000_000)).toBe("deux milliards");
  });

  it("writes the caution de soumission from screen 40", () => {
    // 84 200,00 DA — the figure on the real règlement de consultation.
    expect(frenchNumberInWords(84_200)).toBe("quatre-vingt-quatre mille deux cents");
  });

  it("writes a real invoice total", () => {
    expect(frenchNumberInWords(1_250_000)).toBe("un million deux cent cinquante mille");
    expect(frenchNumberInWords(345_678)).toBe(
      "trois cent quarante-cinq mille six cent soixante-dix-huit",
    );
  });
});

describe("amount in words — the line that prints", () => {
  it("states the centimes even when they are zero", () => {
    // An invoice that says "et zéro centime" cannot be read as one where the
    // centimes were left off.
    expect(amountInWords(84_200, "fr")).toBe(
      "quatre-vingt-quatre mille deux cents dinars algériens et zéro centime",
    );
  });

  it("agrees the dinar and the centime separately", () => {
    expect(amountInWords(1, "fr")).toBe("un dinar algérien et zéro centime");
    expect(amountInWords(1.01, "fr")).toBe("un dinar algérien et un centime");
    expect(amountInWords(2.5, "fr")).toBe("deux dinars algériens et cinquante centimes");
  });

  it("rounds to the centime rather than carrying a float", () => {
    // 0.1 + 0.2 must not print as thirty centimes and a fraction.
    expect(amountInWords(0.1 + 0.2, "fr")).toBe("zéro dinar algérien et trente centimes");
  });

  it("prints in English for a counterparty who reads English", () => {
    expect(englishNumberInWords(84_200)).toBe("eighty-four thousand two hundred");
    expect(amountInWords(84_200, "en")).toBe(
      "eighty-four thousand two hundred Algerian dinars and zero centimes",
    );
    expect(amountInWords(1.01, "en")).toBe("one Algerian dinar and one centime");
  });

  it("refuses an amount it cannot write, rather than writing it wrong", () => {
    expect(() => frenchNumberInWords(-1)).toThrow(/amountOutOfRange/);
    expect(() => frenchNumberInWords(1e12)).toThrow(/amountOutOfRange/);
  });
});
