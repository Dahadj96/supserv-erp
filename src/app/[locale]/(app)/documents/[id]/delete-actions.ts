"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import type { RowDeleteDescription } from "@/components/ui/row-delete";
import {
  DocumentIsIssued,
  discardDocument,
  documentBinState,
  restoreDocument,
} from "@/domain/deletion";

/**
 * Screen 83, on a document.
 *
 * Its own file for the same reason companies and enquiries keep theirs apart:
 * deletion is its own permission, and a file holding nothing else keeps the
 * table in `tests/unit/action-permissions.test.ts` readable.
 *
 * `records.delete` and not `*issue`. Issuing a facture and binning a draft are
 * not the same question — the first asks whether this person may put paper
 * into the world, the second whether they may take a row out of it — and the
 * bin is the Gérant's everywhere else in this system.
 */
async function requireDeleter(locale: string, id: string) {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!session.role || !can(session.role, "records.delete")) {
    redirect(`/${locale}/documents/${id}?error=notAllowedToDelete`);
  }
  return session;
}

export async function discardDocumentAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await requireDeleter(locale, id);
  let dealId: string | null = null;
  try {
    ({ dealId } = await discardDocument({
      id,
      reason: String(form.get("reason") ?? ""),
      actorId: session.userId,
      fromWhere: "18",
    }));
  } catch (error) {
    if (error instanceof DocumentIsIssued) {
      // The screen already greys the button with this sentence. Reaching here
      // means the document was issued between the page rendering and the press
      // — rare, and still worth answering with the reason rather than a throw.
      revalidatePath(`/${locale}/documents/${id}`);
      redirect(`/${locale}/documents/${id}?error=documentIsIssued`);
    }
    throw error;
  }
  revalidatePath(`/${locale}/offers`);
  revalidatePath(`/${locale}/invoices`);
  // Back where the draft was worked on. A document with no enquiry was reached
  // from a list this action has just changed, so Today is the honest landing
  // rather than a list scrolled to a row that is no longer there.
  redirect(dealId ? `/${locale}/deals/${dealId}` : `/${locale}/today`);
}

export async function restoreDocumentAction(locale: string, id: string): Promise<void> {
  const session = await requireDeleter(locale, id);
  await restoreDocument({ id, actorId: session.userId });
  revalidatePath(`/${locale}/offers`);
  revalidatePath(`/${locale}/invoices`);
  redirect(`/${locale}/documents/${id}`);
}

/**
 * V2 — what the confirmation on a list says, before it says it.
 *
 * A document's refusal is about what it IS rather than what hangs off it: once
 * a number is allocated or the row is locked, the paper has left the building
 * and LAW 5 says the only correction is another document. So this reads the
 * same pair `discardDocument` refuses on, and the trash icon on a list can
 * never disagree with the action behind it.
 */
export async function describeDocumentDiscard(
  locale: string,
  id: string,
): Promise<RowDeleteDescription> {
  const session = await getSession();
  const t = await getTranslations({ locale });

  if (!session?.role || !can(session.role, "records.delete")) {
    return { takes: "", refusedBecause: t("documents.notAllowed") };
  }

  const state = await documentBinState(id);
  if (!state.discardable) {
    return { takes: "", refusedBecause: t("documents.alreadyIssued") };
  }

  return { takes: t("rowDelete.takes.document") };
}

/**
 * The same discard, reached from a list.
 *
 * Separate only because of where it lands afterwards: from the document you
 * are standing on the thing you just binned, and from a list you are already
 * where you should be.
 */
export async function discardDocumentFromListAction(
  locale: string,
  back: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await requireDeleter(locale, id);
  try {
    await discardDocument({
      id,
      reason: String(form.get("reason") ?? ""),
      actorId: session.userId,
      fromWhere: "18",
    });
  } catch (error) {
    if (error instanceof DocumentIsIssued) {
      revalidatePath(`/${locale}${back}`);
      redirect(`/${locale}${back}?error=documentIsIssued`);
    }
    throw error;
  }
  revalidatePath(`/${locale}/offers`);
  revalidatePath(`/${locale}/invoices`);
  revalidatePath(`/${locale}${back}`);
  redirect(`/${locale}${back}`);
}
