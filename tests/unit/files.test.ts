import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLES } from "@/auth/can";
import { FILE_KINDS, fileId, parseFileId } from "@/domain/files";
import { contentHeaders, NEEDS, previewMode, RENDERABLE } from "@/domain/files/serving";

/**
 * Screens 60 and 66.
 *
 * The interesting tests here are the two security rules on the serving route,
 * pulled into `src/domain/files/serving.ts` precisely so they could be tested
 * without a request, a session and a database.
 */
const root = join(import.meta.dirname, "..", "..");
const load = (locale: string) =>
  JSON.parse(readFileSync(`${root}/src/i18n/messages/${locale}.json`, "utf8"));

function get(obj: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((o, part) => {
    if (typeof o !== "object" || o === null) return undefined;
    return (o as Record<string, unknown>)[part];
  }, obj);
}

describe("the index id survives a round trip", () => {
  it("parses back to what it was built from", () => {
    const id = fileId("attachment", "9f0c1c34-0b1a-4a7e-9f0e-4a2b6f0d3c11");
    expect(parseFileId(id)).toEqual({
      kind: "attachment",
      id: "9f0c1c34-0b1a-4a7e-9f0e-4a2b6f0d3c11",
    });
  });

  it("refuses a kind nobody declared", () => {
    // The route reads the permission out of `NEEDS[kind]`. A kind that got
    // through here would index that object with something undeclared.
    expect(parseFileId("secrets:../../.env")).toBeNull();
    expect(parseFileId("attachment")).toBeNull();
    expect(parseFileId(":9f0c")).toBeNull();
    expect(parseFileId("attachment:")).toBeNull();
    expect(parseFileId("")).toBeNull();
  });
});

describe("every kind of file sits behind a permission", () => {
  it("names one for each kind, exhaustively", () => {
    for (const kind of FILE_KINDS) {
      expect(NEEDS, kind).toHaveProperty(kind);
    }
  });

  it("keeps raw correspondence away from lecture and chantier", () => {
    // `inbox.view` exists because a mailbox is not a record. Attachments and
    // read dossiers ARE the mailbox, so the same two roles stay out.
    for (const kind of ["attachment", "dossier"] as const) {
      expect(NEEDS[kind]).toBe("inbox.view");
    }
    expect(ROLES.lecture).not.toContain("inbox.view");
    expect(ROLES.chantier).not.toContain("inbox.view");
  });
});

describe("what a browser is allowed to render in place", () => {
  it("downloads HTML rather than running it", () => {
    // The content type on an attachment was chosen by whoever sent the email.
    // Serving text/html inline from our own origin is script with the
    // signed-in user's session — stored XSS, posted to contact@.
    const headers = contentHeaders("invoice.html", "text/html");
    expect(headers.type).toBe("application/octet-stream");
    expect(headers.disposition.startsWith("attachment;")).toBe(true);
  });

  it("is not fooled by a charset or by capitals", () => {
    for (const declared of ["TEXT/HTML", "text/html; charset=utf-8", " text/HTML "]) {
      expect(contentHeaders("x.html", declared).type, declared).toBe("application/octet-stream");
    }
  });

  it("downloads SVG too", () => {
    // An SVG is a document that can carry script, not a picture.
    expect(RENDERABLE.has("image/svg+xml")).toBe(false);
    expect(contentHeaders("logo.svg", "image/svg+xml").type).toBe("application/octet-stream");
  });

  it("still shows a PDF and a photo inline", () => {
    expect(contentHeaders("offer.pdf", "application/pdf")).toEqual({
      type: "application/pdf",
      disposition: `inline; filename="offer.pdf"; filename*=UTF-8''offer.pdf`,
    });
    expect(contentHeaders("scan.jpg", "image/jpeg").disposition.startsWith("inline;")).toBe(true);
  });

  it("treats a missing content type as unknown, not as safe", () => {
    expect(contentHeaders("thing", null).type).toBe("application/octet-stream");
    expect(contentHeaders("thing", "").type).toBe("application/octet-stream");
  });

  it("cannot be broken out of by a filename", () => {
    const headers = contentHeaders('re"port\r\nX-Evil: 1.pdf', "application/pdf");
    expect(headers.disposition).not.toContain('"report');
    expect(headers.disposition).not.toContain("\r");
    expect(headers.disposition).not.toContain("\n");
    // The real name survives, percent-encoded, in the RFC 6266 parameter.
    expect(headers.disposition).toContain("filename*=UTF-8''");
  });

  it("gives an unnamed file a name rather than an empty one", () => {
    // A name made entirely of characters the sanitiser drops would otherwise
    // produce `filename=""`, which some browsers save as the URL's last path
    // segment — here, the raw index id.
    expect(contentHeaders("«»", "application/pdf").disposition).toContain('filename="_"');
    expect(contentHeaders("", "application/pdf").disposition).toContain('filename="file"');
  });
});

describe("what may be shown inside the ERP", () => {
  /**
   * The viewer's rule and the route's rule are the same rule.
   *
   * `previewMode` decides what screen 02 and screen 60 draw a frame for;
   * `contentHeaders` decides what the route sends inline. If the first is ever
   * wider than the second, a Show button downloads the file instead of showing
   * it — a broken preview, which is worse than saying there is not one.
   */
  it("never offers a preview the route would send as a download", () => {
    const declared = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "text/plain",
      "image/svg+xml",
      "text/html",
      "application/zip",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/octet-stream",
      "",
      null,
    ];
    for (const type of declared) {
      if (previewMode(type) === null) continue;
      expect(contentHeaders("f", type).disposition.startsWith("inline;"), `${type}`).toBe(true);
    }
  });

  it("names the right frame for each thing it does offer", () => {
    expect(previewMode("application/pdf")).toBe("pdf");
    expect(previewMode("APPLICATION/PDF")).toBe("pdf");
    expect(previewMode("text/plain; charset=utf-8")).toBe("text");
    for (const image of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(previewMode(image), image).toBe("image");
    }
  });

  it("refuses the two that are documents wearing a picture's name", () => {
    // Same decision as RENDERABLE, reached through the same set rather than a
    // second list somebody could widen without noticing this one.
    expect(previewMode("image/svg+xml")).toBeNull();
    expect(previewMode("text/html")).toBeNull();
  });

  it("says no rather than guessing when nothing was declared", () => {
    // An attachment whose sender's mail client said `application/octet-stream`
    // is a file we know nothing about. The screen says "no preview yet" and
    // hands over the bytes; it does not read the extension and hope.
    expect(previewMode(null)).toBeNull();
    expect(previewMode("")).toBeNull();
    expect(previewMode("application/octet-stream")).toBeNull();
  });

  it("has no preview for a Word or Excel file, and that is task 1.6", () => {
    const office = [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip",
    ];
    for (const type of office) expect(previewMode(type), type).toBeNull();
  });
});

describe("both screens say the same things in both languages", () => {
  const en = load("en");
  const fr = load("fr");

  it("names every file kind on the filter row", () => {
    for (const key of ["all", ...FILE_KINDS]) {
      expect(get(en, `files.kind.${key}`), `${key} (English)`).toBeTypeOf("string");
      expect(get(fr, `files.kind.${key}`), `${key} (French)`).toBeTypeOf("string");
    }
  });

  it("gives the viewer its three sentences", () => {
    // `FileViewer` is drawn by the mailbox and by screen 60, and neither has
    // its own copy of these. A missing French one is a 500 on both.
    for (const key of ["label", "openInNewTab", "cannotEmbed"]) {
      expect(get(en, `viewer.${key}`), `${key} (English)`).toBeTypeOf("string");
      expect(get(fr, `viewer.${key}`), `${key} (French)`).toBeTypeOf("string");
    }
  });

  it("says what it means when there is no preview and when there are no bytes", () => {
    for (const key of ["show", "hide", "noPreviewYet", "notCopiedYet"]) {
      expect(get(en, `files.${key}`), `${key} (English)`).toBeTypeOf("string");
      expect(get(fr, `files.${key}`), `${key} (French)`).toBeTypeOf("string");
    }
  });

  it("has a sentence for every storage state a report can hold", () => {
    // `ready`, `unwritable` and `notConnected` are the three the report emits.
    // A state with no sentence renders as a MISSING_MESSAGE crash, not a chip.
    for (const key of ["ready", "unwritable", "notConnected"]) {
      expect(get(en, `storage.state.${key}`), `${key} (English)`).toBeTypeOf("string");
      expect(get(fr, `storage.state.${key}`), `${key} (French)`).toBeTypeOf("string");
    }
  });
});
