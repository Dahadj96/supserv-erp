import type { Permission } from "@/auth/can";
import type { FileKind } from "./index";

/**
 * The rules `/api/files/[id]` applies before it hands over bytes.
 *
 * They live here rather than in the route so they can be tested without a
 * request, a session and a database. Both of them are security rules, and a
 * security rule nobody can write a test for is a security rule nobody checks.
 */

/**
 * Which permission each kind of file sits behind.
 *
 * Attachments and dossiers are raw correspondence — the argument `inbox.view`
 * was created for, and the reason `lecture` and `chantier` do not hold it. An
 * import spreadsheet is somebody's entire client list, which is a
 * settings-level thing to be handling.
 *
 * `null` is a decision, not an omission: an item's datasheet is a RECORD, and
 * records in this ERP are readable by anybody signed in. `src/auth/can.ts`
 * argues that at length — at six people, records are curated and permissioned
 * individually, and only two read gates exist (`inbox.view` for raw
 * correspondence, `offers.margin.view` for cost). A manufacturer's PDF for a
 * cable is neither. The site foreman who has to fit the thing is exactly who
 * needs it.
 *
 * Exhaustive by type, deliberately. A new file kind will not compile until
 * somebody has decided who may read it — including deciding that everybody may.
 */
export const NEEDS: Record<FileKind, Permission | null> = {
  attachment: "inbox.view",
  dossier: "inbox.view",
  import: "settings.company",
  item: null,
};

/**
 * The only content types a browser is allowed to render in place.
 *
 * Everything else is sent as a download. The content type on an email
 * attachment was chosen by whoever sent the email, and `text/html` served
 * inline from our own origin is script running with the signed-in user's
 * session — stored XSS, deliverable by anybody who can write to contact@.
 * The route's `Content-Security-Policy` is a second lock on the same door;
 * this is the first, and the one that does not depend on browser support.
 *
 * `image/svg+xml` is missing on purpose. An SVG is a document that can carry
 * script, not a picture.
 */
export const RENDERABLE = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
]);

export type ContentHeaders = { type: string; disposition: string };

export function contentHeaders(filename: string, declared: string | null): ContentHeaders {
  // `text/html; charset=utf-8` and ` TEXT/HTML ` are the same claim.
  const type = (declared ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const inline = RENDERABLE.has(type);

  // A quote or a newline in a filename would break out of the header. ASCII for
  // the fallback, percent-encoded UTF-8 for the modern parameter, per RFC 6266.
  const ascii = filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";

  return {
    type: inline ? type : "application/octet-stream",
    disposition: `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  };
}
