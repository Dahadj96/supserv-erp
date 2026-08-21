"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { archiveParty, discardParty, NotDiscardable, restoreParty } from "@/domain/deletion";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 83 — deletion is a permission like any other. Gérant may discard
 * anything in the discardable list; the assistant has no tool at all, which is
 * enforced by absence rather than by a check here.
 */
async function requireDeleter(locale: string) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    throw new Error("unreachable");
  }
  if (!session.role || !can(session.role, "records.delete")) throw new Error("notAllowed");
  return session;
}

export async function discardCompany(locale: string, id: string, formData: FormData) {
  const session = await requireDeleter(locale);
  try {
    await discardParty({
      id,
      reason: String(formData.get("reason") ?? ""),
      actorId: session.userId,
      fromWhere: "22",
    });
  } catch (error) {
    if (error instanceof NotDiscardable) {
      // The honest answer, with a route: it cannot be discarded, but it can be
      // archived, and every document that points at it keeps working.
      redirect({ href: `/companies/${id}?blocked=issued`, locale });
      return;
    }
    throw error;
  }
  revalidatePath(`/${locale}/companies`);
  redirect({ href: "/companies", locale });
}

export async function restoreCompany(locale: string, id: string) {
  const session = await requireDeleter(locale);
  await restoreParty({ id, actorId: session.userId });
  revalidatePath(`/${locale}/companies`);
  redirect({ href: `/companies/${id}`, locale });
}

export async function archiveCompany(locale: string, id: string) {
  const session = await requireDeleter(locale);
  await archiveParty({ id, actorId: session.userId });
  revalidatePath(`/${locale}/companies`);
  redirect({ href: `/companies/${id}`, locale });
}
