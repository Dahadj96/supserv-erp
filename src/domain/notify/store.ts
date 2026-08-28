import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { notificationPref } from "@/db/schema/interface";
import { notificationRead } from "@/db/schema/notification";
import { gather } from "../today/gather";
import type { ItemKind } from "../today/list";
import { counts, type FacetCounts, type Feed, feed, type NotifyFacet } from "./feed";

/**
 * Screen 33's data.
 *
 * The list itself comes from `today/gather()` — the same six sources screen 55
 * reads, unchanged. This file adds the two things that are per-person: what
 * they have already seen, and which kinds they have muted.
 */

export async function readKeys(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ key: notificationRead.notificationKey })
    .from(notificationRead)
    .where(eq(notificationRead.userId, userId));
  return new Set(rows.map((row) => row.key));
}

/**
 * Which kinds this person has switched off, in-app.
 *
 * Absent means ON. A preference row is written only when somebody changes
 * something, so a new user has no rows and sees everything — which is the
 * right default for a notification list, and it means the table stays empty
 * for people who never open Preferences.
 */
export async function mutedKinds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ event: notificationPref.event, inApp: notificationPref.inApp })
    .from(notificationPref)
    .where(eq(notificationPref.userId, userId));
  return new Set(rows.filter((row) => !row.inApp).map((row) => row.event));
}

export type NotifyView = Feed & { facetCounts: FacetCounts };

export async function notifications(
  userId: string,
  facet: NotifyFacet,
  now = new Date(),
): Promise<NotifyView> {
  const [items, seen, muted] = await Promise.all([
    gather(now),
    readKeys(userId),
    mutedKinds(userId),
  ]);

  // Muting hides a kind from the page; it does not stop the fact existing, and
  // the thing itself is still on Today, on the deal, on the invoice. A
  // preference that could make an overdue invoice invisible everywhere would
  // be a way to lose money by clicking a toggle.
  const visible = items.filter((item) => !muted.has(item.kind));

  return {
    ...feed(visible, seen, now, facet),
    facetCounts: counts(visible, seen, now),
  };
}

/** The bell. Counted over everything visible, whatever page you are on. */
export async function unreadCount(userId: string, now = new Date()): Promise<number> {
  const view = await notifications(userId, "all", now);
  return view.unread;
}

export async function markRead(userId: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db
    .insert(notificationRead)
    .values(keys.map((notificationKey) => ({ userId, notificationKey })))
    // Reading a thing twice is not two facts, and it is not a new time either:
    // the first time somebody saw it is the interesting one.
    .onConflictDoNothing();
}

export async function markUnread(userId: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db
    .delete(notificationRead)
    .where(
      and(eq(notificationRead.userId, userId), inArray(notificationRead.notificationKey, keys)),
    );
}

/** "Mark all read" — over what is on the page now, not over history. */
export async function markAllRead(userId: string, now = new Date()): Promise<number> {
  const view = await notifications(userId, "all", now);
  const keys = view.groups.flatMap((group) =>
    group.items.filter((item) => !item.read).map((item) => item.id),
  );
  await markRead(userId, keys);
  return keys.length;
}

export async function setInApp(userId: string, kind: ItemKind, on: boolean): Promise<void> {
  await db
    .insert(notificationPref)
    .values({ userId, event: kind, inApp: on })
    .onConflictDoUpdate({
      target: [notificationPref.userId, notificationPref.event],
      set: { inApp: on },
    });
}
