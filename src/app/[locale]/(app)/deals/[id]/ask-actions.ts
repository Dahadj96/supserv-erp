"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { createRequest, SourcingRefused } from "@/domain/deal/sourcing-store";

/**
 * Screen 06's "Ask suppliers" button.
 *
 * Creates the request DRAFTED and sends nobody anything. Screen 67 is where a
 * person marks it sent, after they have actually written the emails — the
 * safety rail `NEVER_AUTO_REPLY`, and the reason screen 05's derived stage can
 * tell "thinking about sourcing" from "four suppliers asked".
 */
export async function askSuppliersAction(
  locale: string,
  dealId: string,
  form: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);

  const supplierIds = form.getAll("supplierId").map(String).filter(Boolean);
  const replyBy = String(form.get("replyBy") ?? "").trim();

  let id: string;
  try {
    id = await createRequest({
      dealId,
      subject: String(form.get("subject") ?? "").trim(),
      supplierIds,
      replyBy: replyBy ? new Date(replyBy) : null,
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof SourcingRefused) {
      redirect(`/${locale}/deals/${dealId}?error=${error.reason}`);
    }
    throw error;
  }
  redirect(`/${locale}/sourcing/${id}`);
}
