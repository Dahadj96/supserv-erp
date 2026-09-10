"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { type BinKind, PurgeRefused, purgeFromBin } from "@/domain/deletion";

/**
 * V3 — screen 83's one irreversible button.
 *
 * `records.purge` and not `records.delete`: binning is how a mistyped enquiry
 * gets tidied away and is undone by pressing Restore, while this takes the row
 * out of the database and nobody can put it back. Whoever binned it does not
 * get to finish the job.
 *
 * THE TYPED CONFIRMATION IS CHECKED HERE, not only in the browser. A client-side
 * check is a courtesy to the person typing; a server-side one is what stops the
 * request that skipped the screen.
 */
export async function purgeAction(
  locale: string,
  kind: BinKind,
  id: string,
  /** What the row calls itself. The typed word has to match this exactly. */
  expected: string,
  form: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!session.role || !can(session.role, "records.purge")) {
    redirect(`/${locale}/settings/bin?error=notAllowedToPurge`);
  }

  const typed = String(form.get("confirm") ?? "").trim();
  if (typed !== expected.trim()) {
    redirect(`/${locale}/settings/bin?error=confirmDidNotMatch`);
  }

  try {
    await purgeFromBin({ kind, id, actorId: session.userId });
  } catch (error) {
    if (error instanceof PurgeRefused) {
      // `stillReferenced` carries the table Postgres named. It is not a
      // translated word and it is not meant to be one: it is the answer to
      // "why not", and vague is worse than technical here.
      const detail = error.by ? `&by=${encodeURIComponent(error.by)}` : "";
      revalidatePath(`/${locale}/settings/bin`);
      redirect(`/${locale}/settings/bin?error=${error.reason}${detail}`);
    }
    throw error;
  }

  revalidatePath(`/${locale}/settings/bin`);
  revalidatePath(`/${locale}/settings`);
  redirect(`/${locale}/settings/bin?purged=1`);
}
