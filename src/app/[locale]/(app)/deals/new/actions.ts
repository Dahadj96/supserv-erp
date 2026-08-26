"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { createDeal, SUBMISSION_METHODS } from "@/domain/deal/deal";
import { replaceLines } from "@/domain/deal/lines";
import { parsePaste } from "@/domain/deal/paste";

/**
 * Screen 06's front door: an enquiry arrives, usually as an email somebody is
 * looking at in another window.
 *
 * The paste is re-read on the server rather than trusting the table the browser
 * showed. The browser's copy is what a person SAW; it is not evidence of what
 * the text says, and a line array arriving from a client is a line array
 * somebody can edit. Same rule as screen 61.
 */
export async function createAction(locale: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);

  const partyId = String(form.get("partyId") ?? "").trim();
  const subject = String(form.get("subject") ?? "").trim();
  if (!partyId || !subject) redirect(`/${locale}/deals/new?error=clientAndSubject`);

  const method = String(form.get("submissionMethod") ?? "unknown");
  const deadline = String(form.get("deadlineAt") ?? "").trim();
  const paste = String(form.get("paste") ?? "");

  const id = await createDeal(
    {
      partyId,
      subject,
      contactPersonId: null,
      clientReference: String(form.get("clientReference") ?? "").trim() || null,
      receivedAt: new Date(),
      // `datetime-local` gives a wall-clock string with no zone. Read as local
      // time, which is what the person typing it meant.
      deadlineAt: deadline ? new Date(deadline) : null,
      submissionMethod: (SUBMISSION_METHODS as readonly string[]).includes(method)
        ? (method as (typeof SUBMISSION_METHODS)[number])
        : "unknown",
      currency: String(form.get("currency") ?? "DZD").trim() || "DZD",
      ownerId: session.userId,
      source: "manual",
      intakeMessageId: null,
      expectedValue: null,
      clientInstructions: String(form.get("clientInstructions") ?? "").trim() || null,
    },
    session.userId,
  );

  const read = parsePaste(paste);
  if (read.lines.length > 0) {
    await replaceLines({ dealId: id, lines: read.lines, actorId: session.userId });
  }

  redirect(`/${locale}/deals/${id}`);
}
