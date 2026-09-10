"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canWrite } from "@/auth/can";
import { getSession } from "@/auth/session";
import { DealNotEditable, editDeal, SUBMISSION_METHODS } from "@/domain/deal/deal";

/**
 * V4 — correcting an enquiry.
 *
 * `canWrite`, not `records.delete` and not an issue permission. Fixing a
 * mis-read deadline is the same kind of act as typing the enquiry in the first
 * place, and whoever may do the one may do the other. What makes it safe is not
 * a narrower permission: it is that every change is recorded with a name.
 */
export async function editDealAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!canWrite(session.role)) redirect(`/${locale}/deals/${id}/edit?error=notAllowed`);

  const text = (key: string) => String(form.get(key) ?? "").trim();
  const orNull = (key: string) => text(key) || null;

  const partyId = text("partyId");
  const subject = text("subject");
  if (!partyId || !subject) redirect(`/${locale}/deals/${id}/edit?error=clientAndSubject`);

  const method = text("submissionMethod");
  const deadline = text("deadlineAt");

  let changed: string[] = [];
  try {
    ({ changed } = await editDeal({
      id,
      actorId: session.userId,
      input: {
        partyId,
        contactPersonId: orNull("contactPersonId"),
        subject,
        clientReference: orNull("clientReference"),
        // `datetime-local` gives a wall-clock string with no zone, read as
        // local time — which is what the person typing it meant. Same as the
        // create form, deliberately: two readings of the same widget is how
        // a deadline moves by an hour on save.
        deadlineAt: deadline ? new Date(deadline) : null,
        submissionMethod: (SUBMISSION_METHODS as readonly string[]).includes(method)
          ? (method as (typeof SUBMISSION_METHODS)[number])
          : "unknown",
        currency: text("currency") || "DZD",
        ownerId: orNull("ownerId"),
        clientInstructions: orNull("clientInstructions"),
      },
    }));
  } catch (error) {
    if (error instanceof DealNotEditable) {
      redirect(`/${locale}/deals/${id}/edit?error=${error.reason}`);
    }
    throw error;
  }

  revalidatePath(`/${locale}/deals/${id}`);
  revalidatePath(`/${locale}/deals`);
  // How many fields moved, so the enquiry's own page can say so rather than
  // leaving somebody to work out whether the save took.
  redirect(`/${locale}/deals/${id}?corrected=${changed.length}`);
}
