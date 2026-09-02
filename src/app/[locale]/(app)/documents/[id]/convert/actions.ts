"use server";

import { mayIssue } from "@/auth/can";
import { getSession } from "@/auth/session";
import { CannotConvert, convertDocument } from "@/documents/convert";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 48's one button.
 *
 * It creates a DRAFT. Nothing is issued, no number is reserved, and the
 * proforma is not touched — the facture still has to be read and issued on
 * screen 18, which is where LAW 5 bites.
 */
export async function convertAction(locale: string, id: string, form: FormData) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }

  const target = String(form.get("target") ?? "invoice");
  if (!mayIssue(session.role, target)) {
    redirect({ href: `/documents/${id}/convert?error=notAllowed`, locale });
    return;
  }

  let created: string;
  try {
    created = await convertDocument({
      documentId: id,
      target,
      invoiceDate: String(form.get("invoiceDate") ?? ""),
      dueDate: String(form.get("dueDate") ?? "") || null,
      paymentMethod: String(form.get("paymentMethod") ?? "") || null,
      settlement: String(form.get("settlement") ?? "") || null,
      clientReference: String(form.get("clientReference") ?? "") || null,
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof CannotConvert) {
      redirect({ href: `/documents/${id}/convert?error=${error.why}`, locale });
      return;
    }
    throw error;
  }

  redirect({ href: `/documents/${created}?converted=1`, locale });
}
