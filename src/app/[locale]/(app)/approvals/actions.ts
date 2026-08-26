"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/auth/session";
import { decide, NotAllowed } from "@/domain/approval/store";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 65's two buttons.
 *
 * Neither one touches the thing being gated. They record an answer, and
 * whatever was blocked reads that answer next time somebody tries — which is
 * why a decline loses nothing: "the draft stays".
 */
export async function decideAction(locale: string, approve: boolean, form: FormData) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }

  try {
    await decide({
      requestId: String(form.get("requestId") ?? ""),
      approve,
      note: String(form.get("note") ?? ""),
      role: session.role,
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof NotAllowed) {
      redirect({ href: `/approvals?error=${error.why}`, locale });
      return;
    }
    throw error;
  }

  revalidatePath(`/${locale}/approvals`);
  redirect({ href: `/approvals?decided=${approve ? "approved" : "declined"}`, locale });
}
