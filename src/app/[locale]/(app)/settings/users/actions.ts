"use server";

import { revalidatePath } from "next/cache";
import { can, type Role } from "@/auth/can";
import { getSession } from "@/auth/session";
import { assignRole, RoleRefused } from "@/domain/users";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 30. The only thing this screen changes is which role a person holds,
 * and `users.manage` is the permission that lets you change it — which only the
 * Gérant has, and which the Gérant cannot give away by accident because roles
 * are defined in code, not clicked into a grid.
 */
export async function setUserRole(locale: string, formData: FormData) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }
  if (!session.role || !can(session.role, "users.manage")) {
    redirect({ href: "/settings/users?error=notAllowed", locale });
    return;
  }

  const userId = String(formData.get("userId") ?? "");
  const raw = String(formData.get("role") ?? "");
  const next = raw === "" ? null : (raw as Role);

  try {
    await assignRole(userId, next, session.userId);
  } catch (error) {
    if (error instanceof RoleRefused) {
      redirect({ href: `/settings/users?error=${error.reason}`, locale });
      return;
    }
    throw error;
  }

  revalidatePath(`/${locale}/settings/users`);
  redirect({ href: "/settings/users?saved=1", locale });
}
