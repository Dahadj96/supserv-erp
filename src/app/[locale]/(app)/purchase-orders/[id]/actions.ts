"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { PaymentRefused, recordPayment } from "@/domain/money/store";
import { CannotBuy, receiveGoods, recordSupplierInvoice } from "@/domain/purchase/store";

/**
 * Screen 68's three buttons — the writes the screen was drawn without.
 *
 * A receipt and a supplier invoice are created as DRAFTS and opened on screen
 * 18, where a person reads them and records them (LAW 2). A payment is
 * recorded here, because it has already happened at the bank.
 */

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/** `qty:<lineId>` fields → { lineId: qty }, blanks and zeros dropped. */
function quantities(form: FormData, prefix = "qty:"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (!key.startsWith(prefix)) continue;
    const qty = String(value).trim().replace(/[\s ]/g, "").replace(",", ".");
    if (qty && Number(qty) > 0) out[key.slice(prefix.length)] = qty;
  }
  return out;
}

function back(locale: string, id: string, query = ""): never {
  revalidatePath(`/${locale}/purchase-orders/${id}`);
  redirect(`/${locale}/purchase-orders/${id}${query}`);
}

export async function receiveAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "purchase.order.issue")) back(locale, id, "?error=notAllowed");

  let receiptId: string;
  try {
    receiptId = await receiveGoods({
      orderId: id,
      quantities: quantities(form),
      receivedOn: str(form, "receivedOn") || new Date().toISOString().slice(0, 10),
      supplierRef: str(form, "supplierRef") || null,
      receivedBy: str(form, "receivedBy") || null,
      reserves: str(form, "reserves") || null,
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof CannotBuy) back(locale, id, `?error=${error.why}`);
    throw error;
  }
  redirect(`/${locale}/documents/${receiptId}?created=1`);
}

export async function supplierInvoiceAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "purchase.invoice.record")) back(locale, id, "?error=notAllowed");

  const qty = quantities(form);
  const lines: Record<string, { qty: string; unitPrice: string }> = {};
  for (const [lineId, q] of Object.entries(qty)) {
    const price = str(form, `price:${lineId}`).replace(/[\s ]/g, "").replace(",", ".");
    lines[lineId] = { qty: q, unitPrice: price || "0" };
  }

  let invoiceId: string;
  try {
    invoiceId = await recordSupplierInvoice({
      orderId: id,
      theirNumber: str(form, "theirNumber"),
      invoiceDate: str(form, "invoiceDate") || new Date().toISOString().slice(0, 10),
      dueDate: str(form, "dueDate") || null,
      lines,
      settlement: str(form, "settlement") || null,
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof CannotBuy) back(locale, id, `?error=${error.why}`);
    throw error;
  }
  redirect(`/${locale}/documents/${invoiceId}?created=1`);
}

export async function payAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "payments.record")) back(locale, id, "?error=notAllowed");

  const invoiceId = str(form, "invoiceId");
  const amount = str(form, "amount").replace(/[\s ]/g, "").replace(",", ".");
  try {
    await recordPayment({
      partyId: str(form, "partyId"),
      direction: "out",
      method: str(form, "method") || "virement",
      amount,
      receivedOn: str(form, "paidOn") || new Date().toISOString().slice(0, 10),
      bankRef: str(form, "bankRef") || null,
      allocations: invoiceId ? { [invoiceId]: amount } : {},
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof PaymentRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }
  back(locale, id, "?paid=1");
}
