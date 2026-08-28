import { eq } from "drizzle-orm";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { db } from "@/db";
import { importBatch } from "@/db/schema/import";
import { fileByIndexId, parseFileId } from "@/domain/files";
import { contentHeaders, NEEDS } from "@/domain/files/serving";
import { storagePathFor } from "@/domain/import/batch";
import { storageFor } from "@/storage";

/**
 * The bytes behind screen 60.
 *
 * The id in the URL is the INDEX id — `attachment:9f0c…` — not a storage path.
 * That is deliberate. A route taking a path would have to decide, from a
 * string, whether the caller may read it; a route taking an index id can look
 * up what the file belongs to and apply the permission that owns it. `safeJoin`
 * in `src/storage/local.ts` stops `..` escaping the root, but "cannot escape
 * the root" is not the same claim as "may read this file".
 *
 * No locale segment: bytes have no language.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const decoded = decodeURIComponent(id);

  const parsed = parseFileId(decoded);
  if (!parsed) return new Response("noSuchFile", { status: 404 });

  const needed = NEEDS[parsed.kind];
  if (!session.role || !can(session.role, needed)) {
    // 403, not 404. Screen 79's rule — a permission never hides that a thing
    // exists — applies to the API too, and "not found" would send somebody
    // hunting for a file that is sitting right there.
    return new Response(needed, { status: 403 });
  }

  const row = await fileByIndexId(decoded);
  if (!row) return new Response("noSuchFile", { status: 404 });

  // An import batch derives its path from the batch id rather than storing one,
  // so the path is asked for rather than read off the row.
  let path = row.storagePath;
  if (!path && parsed.kind === "import") {
    const [batch] = await db
      .select({ filename: importBatch.filename })
      .from(importBatch)
      .where(eq(importBatch.id, parsed.id))
      .limit(1);
    if (batch) path = storagePathFor(parsed.id, batch.filename);
  }

  if (!path) {
    // The row exists and the copy does not. For an email attachment that is the
    // normal case rather than a fault: the original is in the mailbox and was
    // never fetched. 409 rather than 404 — the file is real, this copy is not.
    return new Response("bytesNotHere", { status: 409 });
  }

  let body: Buffer;
  try {
    body = await storageFor("working").get(path);
  } catch {
    return new Response("bytesNotHere", { status: 409 });
  }

  const headers = contentHeaders(row.filename, row.contentType);

  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": headers.type,
      "content-disposition": headers.disposition,
      // Private, because this response passed a permission check. A shared
      // cache holding it would serve it to somebody who did not.
      "cache-control": "private, no-store",
      // The bytes came from outside. Nothing here should ever be sniffed into
      // something the browser will execute.
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
