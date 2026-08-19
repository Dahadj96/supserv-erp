"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { userPreference } from "@/db/schema/interface";
import { redirect } from "@/i18n/navigation";
import { DEV_AUTH_ENABLED, getSession, isRole } from "./session";

const COOKIE = "supserv_dev_role";

/** Development only. Deleted the day Better Auth + Entra ID lands. */
export async function signInAsDevUser(role: string) {
  if (!DEV_AUTH_ENABLED) throw new Error("Dev sign-in is disabled outside development");
  if (!isRole(role)) throw new Error(`Unknown role: ${role}`);

  const store = await cookies();
  store.set(COOKIE, role, { httpOnly: true, sameSite: "lax", path: "/" });

  const session = await getSession();
  redirect({ href: "/deals", locale: session?.uiLocale ?? "fr" });
}

export async function signOut(locale: string) {
  const store = await cookies();
  store.delete(COOKIE);
  redirect({ href: "/sign-in", locale });
}

/**
 * LAW 4, first axis: the interface follows the PERSON. This writes
 * `user_preference.ui_locale` — it is the only place the interface language is
 * decided, and it never touches `party.doc_locale`, which follows the
 * counterparty and belongs to the document engine.
 */
export async function setUiLocale(locale: string, nextPath: string) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }

  const existing = await db
    .select({ userId: userPreference.userId })
    .from(userPreference)
    .where(eq(userPreference.userId, session.userId))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(userPreference).values({ userId: session.userId, uiLocale: locale });
  } else {
    await db
      .update(userPreference)
      .set({ uiLocale: locale })
      .where(eq(userPreference.userId, session.userId));
  }

  redirect({ href: nextPath, locale });
}
