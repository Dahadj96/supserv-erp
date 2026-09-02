"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { DecisionRefused, decide, recordLost, reopen } from "@/domain/deal/deal";

/**
 * Screen 06's three buttons.
 *
 * Each of them refuses in a way a person can read. `DecisionRefused` carries a
 * key, the page turns it into a sentence, and nothing reaches the browser as a
 * stack trace — a refusal is information, and information belongs on the screen
 * rather than in a log.
 */

function back(locale: string, id: string, error?: string): never {
  revalidatePath(`/${locale}/deals/${id}`);
  redirect(error ? `/${locale}/deals/${id}?error=${error}` : `/${locale}/deals/${id}`);
}

export async function decideAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "offers.issue")) redirect(`/${locale}/deals/${id}?error=notAllowed`);

  const choice = String(form.get("decision") ?? "");
  if (choice !== "pursue" && choice !== "no_bid") back(locale, id, "unknownReason");

  const reason = String(form.get("reason") ?? "").trim();
  const note = String(form.get("note") ?? "").trim();
  const expected = String(form.get("expectedValue") ?? "").trim();

  try {
    await decide({
      dealId: id,
      decision: choice,
      reason: (reason || null) as never,
      note: note || null,
      // Untouched rather than blanked when the field is left empty — an empty
      // box means "I did not change this", not "the value is nothing".
      ...(expected ? { expectedValue: expected } : {}),
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof DecisionRefused) back(locale, id, error.reason);
    throw error;
  }
  back(locale, id);
}

export async function lostAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "offers.issue")) redirect(`/${locale}/deals/${id}?error=notAllowed`);

  try {
    await recordLost({
      dealId: id,
      reason: String(form.get("reason") ?? ""),
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof DecisionRefused) back(locale, id, error.reason);
    throw error;
  }
  back(locale, id);
}

export async function reopenAction(locale: string, id: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "offers.issue")) redirect(`/${locale}/deals/${id}?error=notAllowed`);
  await reopen({ dealId: id, actorId: session.userId });
  back(locale, id);
}
