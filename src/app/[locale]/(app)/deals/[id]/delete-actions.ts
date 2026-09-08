"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { discardDeal, NotDiscardable, restoreDeal } from "@/domain/deletion";

/**
 * Screen 83, on an enquiry.
 *
 * Kept out of `actions.ts` for the same reason companies keep theirs apart:
 * deletion is its own permission, and a file that holds nothing else makes the
 * permission table in `tests/unit/action-permissions.test.ts` readable.
 */
async function requireDeleter(locale: string, id: string) {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!session.role || !can(session.role, "records.delete")) {
    redirect(`/${locale}/deals/${id}?error=notAllowed`);
  }
  return session;
}

export async function discardDealAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await requireDeleter(locale, id);
  try {
    await discardDeal({
      id,
      reason: String(form.get("reason") ?? ""),
      actorId: session.userId,
      fromWhere: "06",
    });
  } catch (error) {
    if (error instanceof NotDiscardable) {
      // The honest answer with a route, as on screen 22: it cannot go in the
      // bin, and the page says why rather than the button vanishing.
      revalidatePath(`/${locale}/deals/${id}`);
      redirect(`/${locale}/deals/${id}?error=hasIssuedDocuments`);
    }
    throw error;
  }
  revalidatePath(`/${locale}/deals`);
  redirect(`/${locale}/deals`);
}

export async function restoreDealAction(locale: string, id: string): Promise<void> {
  const session = await requireDeleter(locale, id);
  await restoreDeal({ id, actorId: session.userId });
  revalidatePath(`/${locale}/deals`);
  redirect(`/${locale}/deals/${id}`);
}
