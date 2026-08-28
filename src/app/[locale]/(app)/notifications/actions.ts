"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/auth/session";
import { markAllRead, markRead, markUnread, setInApp } from "@/domain/notify/store";
import { ITEM_KINDS, type ItemKind } from "@/domain/today/list";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 33's writes. All four are about one person's own view of the list —
 * there is no permission beyond being signed in, because reading a
 * notification is not access to anything the reader did not already have.
 */
async function requireUser(locale: string) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    throw new Error("unreachable");
  }
  return session;
}

export async function markReadAction(locale: string, key: string) {
  const session = await requireUser(locale);
  await markRead(session.userId, [key]);
  revalidatePath(`/${locale}/notifications`);
}

export async function markUnreadAction(locale: string, key: string) {
  const session = await requireUser(locale);
  await markUnread(session.userId, [key]);
  revalidatePath(`/${locale}/notifications`);
}

export async function markAllReadAction(locale: string) {
  const session = await requireUser(locale);
  await markAllRead(session.userId);
  revalidatePath(`/${locale}/notifications`);
}

export async function toggleKindAction(locale: string, kind: string, formData: FormData) {
  const session = await requireUser(locale);
  if (!(ITEM_KINDS as readonly string[]).includes(kind)) throw new Error("unknownKind");
  // The checkbox is absent from the form when unticked, which is how HTML
  // works and the reason this reads presence rather than a value.
  await setInApp(session.userId, kind as ItemKind, formData.get("on") !== null);
  revalidatePath(`/${locale}/notifications`);
}
