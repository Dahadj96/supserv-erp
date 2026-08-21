"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { loadBatch, previewUpload } from "@/domain/import/batch";
import { runImport, UndoExpired, undoImport } from "@/domain/import/run";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 62. An import writes hundreds of records at once, so it is
 * `settings.company` — the Gérant. Undo is the same permission: somebody who
 * may not import may not un-import either.
 */
async function requireImporter(locale: string) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    throw new Error("unreachable");
  }
  if (!session.role || !can(session.role, "settings.company")) throw new Error("notAllowed");
  return session;
}

/** Step 1 and 2 — save the file, read it, and show what it would do. */
export async function uploadForPreview(locale: string, formData: FormData) {
  const session = await requireImporter(locale);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect({ href: "/settings/import?error=noFile", locale });
    return;
  }

  let batchId: string;
  try {
    const batch = await previewUpload({
      filename: file.name,
      body: Buffer.from(await file.arrayBuffer()),
      actorId: session.userId,
    });
    batchId = batch.id;
  } catch (error) {
    const key =
      error instanceof Error && error.message === "emptySheet" ? "emptySheet" : "unreadable";
    redirect({ href: `/settings/import?error=${key}`, locale });
    return;
  }

  redirect({ href: `/settings/import?batch=${batchId}`, locale });
}

/** Step 4 — write it, from the same file the preview read. */
export async function commitBatch(locale: string, batchId: string, formData: FormData) {
  const session = await requireImporter(locale);

  const batch = await loadBatch(batchId);
  if (!batch) {
    redirect({ href: "/settings/import?error=noBatch", locale });
    return;
  }

  const { imported } = await runImport({
    prepared: batch.prepared,
    filename: batch.filename,
    sheetName: batch.sheetName ?? "",
    mapping: batch.mapping,
    actorId: session.userId,
    role: String(formData.get("role") ?? "client"),
    batchId,
  });

  revalidatePath(`/${locale}/companies`);
  revalidatePath(`/${locale}/contacts`);
  redirect({ href: `/settings/import?imported=${imported}&batch=${batchId}`, locale });
}

export async function undoBatch(locale: string, batchId: string) {
  const session = await requireImporter(locale);
  try {
    const { removed, kept } = await undoImport(batchId, session.userId);
    revalidatePath(`/${locale}/companies`);
    revalidatePath(`/${locale}/contacts`);
    redirect({ href: `/settings/import?undone=${removed}&kept=${kept}`, locale });
  } catch (error) {
    if (error instanceof UndoExpired) {
      redirect({ href: "/settings/import?error=undoExpired", locale });
      return;
    }
    throw error;
  }
}
