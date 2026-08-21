"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { dismissDuplicate, type FieldChoices, mergeParties } from "@/domain/merge";
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

/** "Not a duplicate" is remembered, so the same pair is never suggested again. */
export async function notADuplicate(locale: string, aId: string, bId: string) {
  const session = await requireMerger(locale);
  await dismissDuplicate({ aId, bId, actorId: session.userId });
  revalidatePath(`/${locale}/companies/duplicates`);
  redirect({ href: "/companies/duplicates", locale });
}
