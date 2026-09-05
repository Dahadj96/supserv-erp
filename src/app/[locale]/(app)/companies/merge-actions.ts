"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import {
  dismissDuplicate,
  type FieldChoices,
  MergeRefused,
  mergeParties,
  unmergeParties,
} from "@/domain/merge";
import { MERGE_FIELDS } from "@/domain/merge-preview";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 84. Merging is `merge.execute`, not `records.delete` — a merge is not
 * a delete, and the two permissions are held by different people on purpose:
 * commercial and achats tidy their own duplicates without being able to remove
 * anything.
 */
async function requireMerger(locale: string) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    throw new Error("unreachable");
  }
  if (!session.role || !can(session.role, "merge.execute")) throw new Error("notAllowed");
  return session;
}

export async function mergeCompanies(
  locale: string,
  keptId: string,
  retiredId: string,
  formData: FormData,
) {
  const session = await requireMerger(locale);

  // Only fields a person was actually asked about. Anything absent from the
  // form is absent from the log, rather than being recorded as a decision
  // nobody made.
  const choices: FieldChoices = {};
  for (const field of MERGE_FIELDS) {
    const value = formData.get(`choice.${field}`);
    if (value === "kept" || value === "retired") choices[field] = value;
  }

  await mergeParties({ keptId, retiredId, choices, actorId: session.userId });

  revalidatePath(`/${locale}/companies`);
  redirect({ href: `/companies/${keptId}?merged=1`, locale });
}

/**
 * Put a merge back — screen 82's banner, within the thirty-day window.
 *
 * `merge.execute`, the same permission that made it: undoing a merge is the
 * same act of judgement about the same two companies, and a window that only
 * the Gérant can use is a window that stays shut while he is in Adrar.
 */
export async function unmergeCompanies(locale: string, mergeLogId: string, keptId: string) {
  const session = await requireMerger(locale);

  try {
    await unmergeParties({ mergeLogId, actorId: session.userId });
  } catch (error) {
    if (error instanceof MergeRefused) {
      // Its own parameter: `blocked` on this page already means the bin
      // refusing a delete, and two meanings on one key is how a banner ends up
      // saying the wrong thing about the right refusal.
      redirect({ href: `/companies/${keptId}?unmergeBlocked=${error.reason}`, locale });
      return;
    }
    throw error;
  }

  revalidatePath(`/${locale}/companies`);
  redirect({ href: `/companies/${keptId}?unmerged=1`, locale });
}

/** "Not a duplicate" is remembered, so the same pair is never suggested again. */
export async function notADuplicate(locale: string, aId: string, bId: string) {
  const session = await requireMerger(locale);
  await dismissDuplicate({ aId, bId, actorId: session.userId });
  revalidatePath(`/${locale}/companies/duplicates`);
  redirect({ href: "/companies/duplicates", locale });
}
