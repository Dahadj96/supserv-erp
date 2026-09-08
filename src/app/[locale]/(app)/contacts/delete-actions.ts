"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { discardPerson, PersonOnSite, restorePerson } from "@/domain/deletion";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 83, on a person — a buyer at a client (screen 76) or a welder
 * (screen 51). Both lists read the same table, so both press this action.
 *
 * Kept in its own file for the reason companies and deals keep theirs apart:
 * deletion is its own permission, and a file holding nothing else makes the
 * table in `tests/unit/action-permissions.test.ts` readable.
 */

/**
 * Where to land afterwards.
 *
 * The same control is drawn in the contacts panel on screen 22 and in the list
 * on screen 51, and somebody who removes a name expects to still be looking at
 * the list they removed it from. The form says which page it was pressed on —
 * but a redirect target read off a form is a redirect somebody else can write,
 * so only a path inside this ERP is accepted and anything else falls back.
 */
function safeBack(raw: FormDataEntryValue | null): string {
  const back = String(raw ?? "");
  return back.startsWith("/") && !back.startsWith("//") ? back : "/contacts";
}

export async function discardPersonAction(locale: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }

  const id = String(form.get("id") ?? "");
  const back = safeBack(form.get("back"));

  /**
   * `aria-disabled`, not `disabled` — a grey button still submits, because a
   * control nobody can focus is a reason nobody can read. So every reason the
   * button was grey has to be a sentence on the way back too, rather than a
   * throw. Both of them land on the list the button was pressed on.
   */
  if (!session.role || !can(session.role, "records.delete")) {
    redirect({ href: `${back}?blocked=notAllowed`, locale });
    return;
  }

  try {
    await discardPerson({
      id,
      reason: String(form.get("reason") ?? ""),
      actorId: session.userId,
      fromWhere: String(form.get("screen") ?? "") || "76",
    });
  } catch (error) {
    if (error instanceof PersonOnSite) {
      redirect({ href: `${back}?blocked=onSite`, locale });
      return;
    }
    throw error;
  }

  revalidatePath(`/${locale}/contacts`);
  revalidatePath(`/${locale}/people`);
  redirect({ href: back, locale });
}

export async function restorePersonAction(locale: string, id: string): Promise<void> {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }
  if (!session.role || !can(session.role, "records.delete")) {
    redirect({ href: "/settings/bin?error=notAllowed", locale });
    return;
  }

  await restorePerson({ id, actorId: session.userId });
  revalidatePath(`/${locale}/contacts`);
  revalidatePath(`/${locale}/people`);
  redirect({ href: "/settings/bin", locale });
}
