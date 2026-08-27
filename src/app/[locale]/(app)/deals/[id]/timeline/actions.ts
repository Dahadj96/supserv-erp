"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/auth/session";
import { addNote, NoteRefused } from "@/domain/timeline/gather";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 56's composer.
 *
 * Two of its five tabs work: Note and Log a call. Reply needs sending, which
 * nothing in this system does; Attach a file needs storage, which is screens
 * 60 and 66; and "Add a task" is a note with a date, which is the same button
 * with a different name — see the note on `src/db/schema/note.ts`.
 */
export async function addNoteAction(locale: string, dealId: string, form: FormData) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }

  const happenedOn = String(form.get("happenedOn") ?? "").trim();

  try {
    await addNote({
      entity: "deal",
      entityId: dealId,
      kind: String(form.get("kind") ?? "note"),
      body: String(form.get("body") ?? ""),
      // When it HAPPENED, not when it was typed. A call made in the car and
      // written up that evening happened in the car.
      happenedAt: happenedOn ? new Date(`${happenedOn}T12:00:00Z`) : undefined,
      dueAt: String(form.get("dueAt") ?? "") || null,
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof NoteRefused) {
      redirect({ href: `/deals/${dealId}/timeline?error=${error.why}`, locale });
      return;
    }
    throw error;
  }

  revalidatePath(`/${locale}/deals/${dealId}/timeline`);
  redirect({ href: `/deals/${dealId}/timeline?noted=1`, locale });
}
