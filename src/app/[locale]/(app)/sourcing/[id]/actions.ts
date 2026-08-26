"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { markSent, recordAnswer, recordChase, SourcingRefused } from "@/domain/deal/sourcing-store";

/**
 * Screen 67's buttons.
 *
 * "Send" and "Chase" RECORD that a message went out; they do not send one.
 * That is the safety rail `NEVER_AUTO_REPLY` and LAW 6 — nothing in this system
 * writes to a supplier on its own, and the day it does will be a day somebody
 * decided to build it on purpose.
 */

function back(locale: string, id: string, query = ""): never {
  revalidatePath(`/${locale}/sourcing/${id}`);
  redirect(`/${locale}/sourcing/${id}${query}`);
}

export async function markSentAction(locale: string, id: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  try {
    await markSent({ requestId: id, actorId: session.userId });
  } catch (error) {
    if (error instanceof SourcingRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }
  back(locale, id, "?sent=1");
}

export async function chaseAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);

  const ids = form.getAll("responseId").map(String).filter(Boolean);
  const n = await recordChase({ responseIds: ids, actorId: session.userId });
  back(locale, id, `?chased=${n}`);
}

export async function answerAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);

  const responseId = String(form.get("responseId") ?? "");
  const status = String(form.get("status") ?? "");

  // Line prices arrive as `price:<dealLineId>` so they can be read back into a
  // map without a second round trip to find out which lines exist.
  const prices: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("price:")) continue;
    const text = String(value).trim();
    if (text) prices[key.slice("price:".length)] = text;
  }

  const number = (name: string) => {
    const raw = String(form.get(name) ?? "").trim();
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
  };

  try {
    await recordAnswer({
      responseId,
      status,
      validityDays: number("validityDays"),
      leadTimeDays: number("leadTimeDays"),
      currency: String(form.get("currency") ?? "DZD"),
      isExclVat: String(form.get("vat") ?? "excl") !== "incl",
      note: String(form.get("note") ?? ""),
      prices,
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof SourcingRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }
  back(locale, id, "?recorded=1");
}
