"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { ensureTemplatesExist, reviseFooter, TemplateRefused } from "@/documents/templates";
import { redirect } from "@/i18n/navigation";

async function requireOwner(locale: string) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    throw new Error("unreachable");
  }
  if (!session.role || !can(session.role, "settings.company")) {
    redirect({ href: "/settings/templates?error=notAllowed", locale });
    throw new Error("unreachable");
  }
  return session;
}

export async function seedTemplatesAction(locale: string) {
  await requireOwner(locale);
  const written = await ensureTemplatesExist();
  revalidatePath(`/${locale}/settings/templates`);
  redirect({ href: `/settings/templates?written=${written}`, locale });
}

export async function reviseFooterAction(locale: string, form: FormData) {
  const session = await requireOwner(locale);
  const id = String(form.get("id") ?? "");
  const mentions = String(form.get("mentions") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  try {
    const next = await reviseFooter(id, mentions, session.userId);
    revalidatePath(`/${locale}/settings/templates`);
    redirect({ href: `/settings/templates?revised=${next.version}`, locale });
  } catch (error) {
    if (error instanceof TemplateRefused) {
      redirect({ href: `/settings/templates?error=${error.reason}`, locale });
      return;
    }
    throw error;
  }
}
