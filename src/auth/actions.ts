"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { userPreference } from "@/db/schema/interface";
import { redirect } from "@/i18n/navigation";
import { auth } from "./index";
import { getSession } from "./session";

/**
 * Sign-in itself is started from the browser — see `src/auth/client.ts`, and
 * the sign-in button next to it. Signing OUT is safe to do here, because the
 * redirect afterwards is same-origin.
 */
export async function signOut(locale: string) {
  await auth.api.signOut({ headers: await headers() });
  redirect({ href: "/sign-in", locale });
}

/**
 * LAW 4, first axis: the interface follows the PERSON. This writes
 * `user_preference.ui_locale` — the only place the interface language is
 * decided. It never touches `party.doc_locale`, which follows the counterparty
 * and belongs to the document engine.
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
