"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { runSweep } from "@/domain/sweep";

/**
 * Screen 29 — "Clear my test data", the two presses it takes.
 *
 * Its own file, like every other deletion action in this ERP: the bin is its
 * own permission, and a file holding nothing else keeps the table in
 * `tests/unit/action-permissions.test.ts` readable.
 *
 * `records.delete` — the Gérant's, and only his. This is the widest thing
 * anybody can do to this database in one press, and it is the same permission
 * that binning one company takes, because it is that act repeated.
 */
async function requireDeleter(locale: string) {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!session.role || !can(session.role, "records.delete")) {
    redirect(`/${locale}/settings/clear?error=notAllowed`);
  }
  return session;
}

/**
 * A moment, read off the form and put in the URL.
 *
 * `datetime-local` hands back "2026-09-08T00:00" with no zone, which `Date`
 * reads in the server's own — the mini PC in the Adrar office, which is where
 * the person choosing the moment is sitting.
 */
function moment(value: unknown): Date | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Press one: work out what would go, and show it. Nothing is written here. */
export async function previewSweep(locale: string, form: FormData): Promise<void> {
  await requireDeleter(locale);

  const before = moment(form.get("before"));
  if (!before) redirect(`/${locale}/settings/clear?error=badDate`);

  redirect(`/${locale}/settings/clear?before=${encodeURIComponent(before.toISOString())}`);
}

/**
 * Press two: the typed word, then the sweep.
 *
 * The word is compared against the message file for the locale the person is
 * reading, because a French speaker asked to type EFFACER and refused for not
 * typing CLEAR would rightly conclude the system was broken. LAW 4 — the
 * interface follows the person.
 */
export async function clearTestData(locale: string, form: FormData): Promise<void> {
  const session = await requireDeleter(locale);
  const t = await getTranslations({ locale });

  const before = moment(form.get("before"));
  if (!before) redirect(`/${locale}/settings/clear?error=badDate`);

  const typed = String(form.get("confirm") ?? "")
    .trim()
    .toLocaleUpperCase(locale);
  if (typed !== t("clearData.confirmWord").toLocaleUpperCase(locale)) {
    redirect(
      `/${locale}/settings/clear?before=${encodeURIComponent(before.toISOString())}&error=notConfirmed`,
    );
  }

  const typedReason = String(form.get("reason") ?? "").trim();
  const { id } = await runSweep({
    before,
    // A reason is kept on every row it touches, and shows in the bin beside
    // each one. Left blank it would read "—" thirty times over, so the screen's
    // own sentence stands in — in the language the person was working in.
    reason: typedReason || t("clearData.defaultReason"),
    actorId: session.userId,
  });

  for (const path of ["/deals", "/companies", "/contacts", "/offers", "/invoices", "/today"]) {
    revalidatePath(`/${locale}${path}`);
  }
  redirect(`/${locale}/settings/clear?done=${id}`);
}
