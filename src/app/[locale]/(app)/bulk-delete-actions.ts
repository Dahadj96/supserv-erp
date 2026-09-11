"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import type { BulkDeletePreview } from "@/components/data/bulk-delete";
import { type BulkKind, bulkDiscard, bulkDiscardPreview } from "@/domain/deletion";

/**
 * Bulk delete, for every list that owns records — one file, four kinds.
 *
 * Deliberately NOT one pair of actions per screen. The rules that decide
 * whether a row may go are the domain's, the permission is the same
 * `records.delete` everywhere, and four copies of this would be four places for
 * one of them to drift. What a screen supplies is which kind it holds and where
 * to land afterwards, and nothing else.
 *
 * There is a cap. Fifty is not a technical limit — the loop would happily do
 * five hundred — it is the number above which "I ticked the wrong filter" stops
 * being recoverable by reading the bin. The bin holds the rows either way; what
 * it does not hold is the afternoon spent working out which fifty of the five
 * hundred were the ones you meant.
 */
const MOST_AT_ONCE = 50;

async function deleter(locale: string, back: string) {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!session.role || !can(session.role, "records.delete")) {
    redirect(`/${locale}${back}?error=notAllowed`);
  }
  return session;
}

/** What WOULD happen. Same guards as the discard; nothing is written. */
export async function previewBulkDelete(
  locale: string,
  kind: BulkKind,
  ids: string[],
): Promise<BulkDeletePreview> {
  const session = await getSession();
  const t = await getTranslations({ locale });

  if (!session?.role || !can(session.role, "records.delete")) {
    return { canGo: 0, refused: [{ label: "—", reason: "notAllowed" }] };
  }
  if (ids.length > MOST_AT_ONCE) {
    return {
      canGo: 0,
      refused: [{ label: t("list.bulkTooMany", { most: MOST_AT_ONCE }), reason: "tooMany" }],
    };
  }

  return bulkDiscardPreview({ kind, ids: ids.slice(0, MOST_AT_ONCE) });
}

export async function runBulkDelete(
  locale: string,
  kind: BulkKind,
  back: string,
  ids: string[],
  form: FormData,
): Promise<void> {
  const session = await deleter(locale, back);
  if (ids.length === 0 || ids.length > MOST_AT_ONCE) {
    redirect(`/${locale}${back}?error=bulkTooMany`);
  }

  const { binned, refused } = await bulkDiscard({
    kind,
    ids,
    reason: String(form.get("reason") ?? ""),
    actorId: session.userId,
  });

  revalidatePath(`/${locale}${back}`);
  revalidatePath(`/${locale}/settings/bin`);

  // The refusals travel back NAMED. A bulk action that says "3 were skipped"
  // leaves somebody comparing two lists of fifty by hand.
  const names = refused
    .slice(0, 5)
    .map((r) => `${r.label}:${r.reason}`)
    .join("|");
  const query = new URLSearchParams({ binned: String(binned) });
  if (names) query.set("refused", names);
  if (refused.length > 5) query.set("more", String(refused.length - 5));

  redirect(`/${locale}${back}?${query.toString()}`);
}
