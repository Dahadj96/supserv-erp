"use server";

import { mayIssue } from "@/auth/can";
import { getSession } from "@/auth/session";
import { billFrom, CannotBill } from "@/documents/bill";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 72's one button.
 *
 * Creates a DRAFT facture. The frame's header offers "Issue the invoice"
 * directly; this does not, because issuing reserves a number and runs the
 * compliance profile, and that happens in one place — screen 18. The draft
 * lands there with everything filled in and a person reads it before it
 * becomes a legal document nobody may edit (LAW 5).
 */
export async function billAction(locale: string, sourceId: string, form: FormData) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }
  if (!mayIssue(session.role, "invoice")) {
    redirect({ href: `/invoices?error=notAllowed`, locale });
    return;
  }

  const quantities: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (!name.startsWith("qty:")) continue;
    const qty = String(value).replace(/\s/g, "").replace(",", ".");
    if (Number(qty) > 0) quantities[name.slice(4)] = qty;
  }

  let id: string;
  try {
    id = await billFrom({
      sourceId,
      quantities,
      invoiceDate: String(form.get("invoiceDate") ?? ""),
      dueDate: String(form.get("dueDate") ?? "") || null,
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof CannotBill) {
      const scope = String(form.get("scope") ?? "delivered");
      redirect({
        href: `/invoices/new?source=${sourceId}&scope=${scope}&error=${error.why}`,
        locale,
      });
      return;
    }
    throw error;
  }

  redirect({ href: `/documents/${id}?converted=1`, locale });
}
