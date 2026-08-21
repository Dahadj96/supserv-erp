"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { ensureRulesExist } from "@/documents/compliance";
import { ConfirmRefused, confirm, unconfirm } from "@/domain/compliance-profile";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 69. Confirming a rule changes what the system refuses to do, so it
 * takes `settings.company` — the Gérant. It is not a preference.
 */
async function requireOwner(locale: string) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    throw new Error("unreachable");
  }
  if (!session.role || !can(session.role, "settings.company")) {
    redirect({ href: "/settings/compliance?error=notAllowed", locale });
    throw new Error("unreachable");
  }
  return session;
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export async function confirmRuleAction(locale: string, form: FormData) {
  const session = await requireOwner(locale);
  const code = text(form, "code");

  try {
    await confirm(
      code,
      text(form, "who"),
      text(form, "on") || new Date().toISOString().slice(0, 10),
      session.userId,
    );
  } catch (error) {
    if (error instanceof ConfirmRefused) {
      redirect({ href: `/settings/compliance?error=${error.reason}`, locale });
      return;
    }
    throw error;
  }

  revalidatePath(`/${locale}/settings/compliance`);
  redirect({ href: `/settings/compliance?confirmed=${encodeURIComponent(code)}`, locale });
}

export async function unconfirmRuleAction(locale: string, form: FormData) {
  const session = await requireOwner(locale);
  const code = text(form, "code");

  try {
    await unconfirm(code, session.userId, text(form, "reason"));
  } catch (error) {
    if (error instanceof ConfirmRefused) {
      redirect({ href: `/settings/compliance?error=${error.reason}`, locale });
      return;
    }
    throw error;
  }

  revalidatePath(`/${locale}/settings/compliance`);
  redirect({ href: `/settings/compliance?unconfirmed=${encodeURIComponent(code)}`, locale });
}

/**
 * The rules are written down before anybody confirms them — a rule nobody has
 * written down cannot be confirmed, and a system that invents the rule at the
 * moment it needs it is a system asserting a law on its own authority. This is
 * the button that writes them down on a database that has never issued
 * anything.
 */
export async function seedRulesAction(locale: string) {
  await requireOwner(locale);
  await ensureRulesExist();
  revalidatePath(`/${locale}/settings/compliance`);
  redirect({ href: "/settings/compliance?seeded=1", locale });
}
