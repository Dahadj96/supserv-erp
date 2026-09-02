"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { draftRelance, markRelanceSent, PaymentRefused, recordReply } from "@/domain/money/store";

/**
 * Screen 20's buttons.
 *
 * Every one of them RECORDS. None of them sends. "The policy fires the
 * reminders; a person still approves anything that escalates" — the safety rail
 * `NEVER_AUTO_REPLY`, and LAW 6.
 */

function back(locale: string, query = ""): never {
  revalidatePath(`/${locale}/payments/ageing`);
  redirect(`/${locale}/payments/ageing${query}`);
}

export async function draftAction(locale: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "payments.record"))
    redirect(`/${locale}/payments/ageing?error=notAllowed`);

  try {
    await draftRelance({
      documentId: String(form.get("documentId") ?? ""),
      stepKey: String(form.get("stepKey") ?? "") || null,
      channel: String(form.get("channel") ?? "email"),
      sentTo: String(form.get("sentTo") ?? ""),
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof PaymentRefused) back(locale, `?error=${error.reason}`);
    throw error;
  }
  back(locale, "?drafted=1");
}

export async function markSentAction(locale: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "payments.record"))
    redirect(`/${locale}/payments/ageing?error=notAllowed`);
  await markRelanceSent({
    relanceId: String(form.get("relanceId") ?? ""),
    actorId: session.userId,
  });
  back(locale, "?sent=1");
}

export async function replyAction(locale: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "payments.record"))
    redirect(`/${locale}/payments/ageing?error=notAllowed`);
  await recordReply({
    relanceId: String(form.get("relanceId") ?? ""),
    reply: String(form.get("reply") ?? ""),
    // A promise is a fact about what was said. It stops the policy chasing
    // again until that date, and it is not a payment.
    promisedOn: String(form.get("promisedOn") ?? "") || null,
    actorId: session.userId,
  });
  back(locale, "?replied=1");
}
