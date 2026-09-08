"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { discardNote, NotYourNote, restoreNote } from "@/domain/deletion";

/**
 * Screen 56 — unwriting a note.
 *
 * A note is the only row on the timeline nothing else holds a copy of, which
 * is also why it is the row most likely to be wrong: the wrong deal, the wrong
 * date, half a sentence sent by an accidental Enter. Everything else on that
 * page is a copy of a record with a screen of its own, and is removed there.
 *
 * WHO MAY. Writing a note takes `canWrite` — everybody but `lecture` — while
 * `records.delete` is the Gérant's alone, so "only the Gérant" would leave a
 * Commercial in Adrar waiting for the office to fix their own typo. Your own
 * note is yours; anybody else's takes `records.delete`. That is wider than the
 * permission this action names, and it is named here rather than left to be
 * discovered in `discardNote`.
 */
export async function discardNoteAction(
  locale: string,
  dealId: string,
  form: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);

  try {
    await discardNote({
      id: String(form.get("noteId") ?? ""),
      reason: String(form.get("reason") ?? ""),
      actorId: session.userId,
      anyAuthor: session.role ? can(session.role, "records.delete") : false,
      fromWhere: "56",
    });
  } catch (error) {
    if (error instanceof NotYourNote) {
      redirect(`/${locale}/deals/${dealId}/timeline?error=notYourNote`);
    }
    throw error;
  }

  revalidatePath(`/${locale}/deals/${dealId}/timeline`);
  redirect(`/${locale}/deals/${dealId}/timeline?removed=1`);
}

/**
 * Taking one back out is screen 83's, and it is `records.delete` like every
 * other restore there — deliberately narrower than the discard above. The bin
 * is one screen that dispatches five kinds of row uniformly, and a restore that
 * asked a different question per kind would be a bin nobody could reason about.
 */
export async function restoreNoteAction(locale: string, id: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!session.role || !can(session.role, "records.delete")) {
    redirect(`/${locale}/settings/bin?error=notAllowed`);
  }

  await restoreNote({ id, actorId: session.userId });
  revalidatePath(`/${locale}/settings/bin`);
  redirect(`/${locale}/settings/bin`);
}
