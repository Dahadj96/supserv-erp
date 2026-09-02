"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canWrite } from "@/auth/can";
import { getSession } from "@/auth/session";
import {
  clearNotApplicable,
  markNotApplicable,
  setRequirement,
  TechnicalRefused,
} from "@/domain/deal/technical-store";

function back(locale: string, id: string, query = ""): never {
  revalidatePath(`/${locale}/deals/${id}/technical`);
  redirect(`/${locale}/deals/${id}/technical${query}`);
}

/** Screen 78's toggle — the answer that decides whether a gap blocks the bid. */
export async function setRequirementAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!canWrite(session.role)) redirect(`/${locale}/deals/${id}/technical?error=notAllowed`);

  try {
    await setRequirement({
      dealId: id,
      requirement: String(form.get("requirement") ?? ""),
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof TechnicalRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }
  back(locale, id);
}

export async function markNotApplicableAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!canWrite(session.role)) redirect(`/${locale}/deals/${id}/technical?error=notAllowed`);

  try {
    await markNotApplicable({
      dealId: id,
      dealLineId: String(form.get("dealLineId") ?? ""),
      // Required. Without it, this is indistinguishable from somebody clicking
      // to make a red row go away.
      reason: String(form.get("reason") ?? ""),
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof TechnicalRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }
  back(locale, id, "?marked=1");
}

export async function clearNotApplicableAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!canWrite(session.role)) redirect(`/${locale}/deals/${id}/technical?error=notAllowed`);
  await clearNotApplicable({
    dealId: id,
    itemId: String(form.get("itemId") ?? ""),
    actorId: session.userId,
  });
  back(locale, id);
}
