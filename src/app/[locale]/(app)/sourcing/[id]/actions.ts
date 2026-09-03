"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can, canAny } from "@/auth/can";
import { getSession } from "@/auth/session";
import { markSent, recordAnswer, recordChase, SourcingRefused } from "@/domain/deal/sourcing-store";
import { CannotBuy, orderFromAnswer } from "@/domain/purchase/store";

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
  if (!canAny(session.role, ["offers.issue", "purchase.order.issue"]))
    redirect(`/${locale}/sourcing/${id}?error=notAllowed`);
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
  if (!canAny(session.role, ["offers.issue", "purchase.order.issue"]))
    redirect(`/${locale}/sourcing/${id}?error=notAllowed`);

  const ids = form.getAll("responseId").map(String).filter(Boolean);
  const n = await recordChase({ responseIds: ids, actorId: session.userId });
  back(locale, id, `?chased=${n}`);
}

export async function answerAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!canAny(session.role, ["offers.issue", "purchase.order.issue"]))
    redirect(`/${locale}/sourcing/${id}?error=notAllowed`);

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

/**
 * Order from the supplier who answered — a draft purchase order at their
 * prices, opened on screen 18 to be read and issued. Placing an order is
 * spending money, so it takes `purchase.order.issue` and nothing less.
 */
export async function orderAction(locale: string, id: string, responseId: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "purchase.order.issue")) back(locale, id, "?error=notAllowed");

  let orderId: string;
  try {
    orderId = await orderFromAnswer({ responseId, actorId: session.userId });
  } catch (error) {
    if (error instanceof CannotBuy) back(locale, id, `?error=${error.why}`);
    throw error;
  }
  redirect(`/${locale}/documents/${orderId}?created=1`);
}
