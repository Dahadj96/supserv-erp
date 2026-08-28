"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import {
  ensureEmailTemplatesExist,
  saveEmailTemplate,
  TemplateRefused,
} from "@/domain/email/templates";
import { redirect } from "@/i18n/navigation";

const HERE = "/settings/email-templates";

async function requireOwner(locale: string) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    throw new Error("unreachable");
  }
  if (!session.role || !can(session.role, "settings.company")) {
    redirect({ href: `${HERE}?error=notAllowed`, locale });
    throw new Error("unreachable");
  }
  return session;
}

export async function seedEmailTemplatesAction(locale: string) {
  await requireOwner(locale);
  const written = await ensureEmailTemplatesExist();
  revalidatePath(`/${locale}${HERE}`);
  redirect({ href: `${HERE}?written=${written}`, locale });
}

export async function saveEmailTemplateAction(locale: string, form: FormData) {
  const session = await requireOwner(locale);
  const id = String(form.get("id") ?? "");

  try {
    const saved = await saveEmailTemplate({
      id,
      subject: String(form.get("subject") ?? ""),
      body: String(form.get("body") ?? ""),
      actorId: session.userId,
    });
    revalidatePath(`/${locale}${HERE}`);
    redirect({ href: `${HERE}?saved=${saved.key}&open=${saved.id}`, locale });
  } catch (error) {
    if (error instanceof TemplateRefused) {
      redirect({ href: `${HERE}?error=${error.reason}&open=${id}`, locale });
      return;
    }
    throw error;
  }
}
