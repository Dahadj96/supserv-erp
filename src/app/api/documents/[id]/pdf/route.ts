import { getSession } from "@/auth/session";
import { NotRenderable, render } from "@/documents/engine";
import { toPdf } from "@/documents/pdf";

/**
 * The bytes. One renderer, one route — screen 18's preview is the same PDF the
 * client will receive, because it IS the PDF the client will receive.
 *
 * No locale segment: LAW 4 puts the document's language on the document, not on
 * whoever is looking at it. A Gérant reading the app in French, previewing a
 * document for an English-reading client, gets an English document.
 *
 * `purpose: "preview"` always. Issuing is a deliberate act with a button and an
 * audit entry behind it; fetching a URL is not, and a GET that consumed an
 * invoice number would be a number lost to a browser prefetch.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("unauthorized", { status: 401 });

  const { id } = await ctx.params;

  try {
    const doc = await render({ documentId: id, purpose: "preview", actorId: session.userId });
    const pdf = await toPdf(doc);
    const stem = doc.number ? doc.number.replace(/[^\w.-]+/g, "-") : `brouillon-${id.slice(0, 8)}`;

    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${stem}.pdf"`,
        // A draft changes every time somebody edits a line. Caching it would
        // show a preview of a document that no longer exists.
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof NotRenderable) return new Response(error.why, { status: 404 });
    throw error;
  }
}
