"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { owings, PaymentRefused, recordPayment } from "@/domain/money/store";

/**
 * Screen 19 — recording money that arrived.
 *
 * The form posts ONE invoice and one amount, which is the case the frame shows
 * and the case that happens fifty times for every split transfer. It reaches
 * `recordPayment` as an allocation map anyway, because a payment is a thing
 * that happened at the bank and where it goes is a separate, editable decision.
 * Making the simple case a field on the invoice would mean unpicking it the
 * first time one transfer settles three invoices.
 *
 * The client is READ OFF THE INVOICE, never posted. A hidden field saying which
 * party this money belongs to is a hidden field somebody can change, and the
 * failure is silent: the payment lands against the right invoice and the wrong
 * client, and every per-client figure on screens 19 and 20 is wrong afterwards.
 */

function back(locale: string, query = ""): never {
  revalidatePath(`/${locale}/payments`);
  revalidatePath(`/${locale}/payments/ageing`);
  redirect(`/${locale}/payments${query}`);
}

export async function recordPaymentAction(locale: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "payments.record")) redirect(`/${locale}/payments?error=notAllowed`);

  const documentId = String(form.get("documentId") ?? "");
  const amount = String(form.get("amount") ?? "").trim();

  const invoice = (await owings()).find((o) => o.documentId === documentId);
  if (!invoice) back(locale, "?error=noSuchInvoice");

  try {
    await recordPayment({
      partyId: invoice.partyId,
      method: String(form.get("method") ?? "virement"),
      amount,
      // The currency the money arrived in, which need not be the invoice's.
      currency: String(form.get("currency") ?? "DZD") || "DZD",
      // The day the money moved, not the day somebody typed it in.
      receivedOn: String(form.get("receivedOn") ?? ""),
      bankRef: String(form.get("bankRef") ?? ""),
      note: String(form.get("note") ?? ""),
      allocations: { [documentId]: amount },
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof PaymentRefused) back(locale, `?error=${error.reason}`);
    throw error;
  }

  back(locale, "?recorded=1");
}
