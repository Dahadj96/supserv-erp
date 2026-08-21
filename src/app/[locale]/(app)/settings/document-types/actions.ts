"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { ensureTypesExist, setActive, TypeRefused } from "@/domain/document-types";
import { redirect } from "@/i18n/navigation";

async function requireOwner(locale: string) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    throw new Error("unreachable");
  }
  if (!session.role || !can(session.role, "settings.company")) {
    redirect({ href: "/settings/document-types?error=notAllowed", locale });
    throw new Error("unreachable");
  }
  return session;
}

export async function seedTypesAction(locale: string) {
  await requireOwner(locale);
  const written = await ensureTypesExist();
  revalidatePath(`/${locale}/settings/document-types`);
  redirect({ href: `/settings/document-types?written=${written}`, locale });
}

export async function toggleTypeAction(locale: string, form: FormData) {
  const session = await requireOwner(locale);
  const kind = String(form.get("kind") ?? "");
  const active = String(form.get("active") ?? "") === "true";

  try {
    await setActive(kind, active, session.userId);
  } catch (error) {
    if (error instanceof TypeRefused) {
      redirect({ href: `/settings/document-types?error=${error.reason}`, locale });
      return;
    }
    throw error;
  }

  revalidatePath(`/${locale}/settings/document-types`);
  redirect({ href: "/settings/document-types", locale });
}
