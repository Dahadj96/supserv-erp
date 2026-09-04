"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canWrite } from "@/auth/can";
import { getSession } from "@/auth/session";
import { capturePrice, PriceRefused } from "@/domain/deal/price-store";

/**
 * Screen 74's one write, from a phone.
 *
 * `canWrite` rather than a named permission: writing down what a shop charges
 * is not a decision about money, it is a note anybody who works here can take.
 * The price is marked verbal and stays unconfirmed until a document backs it,
 * which is where the permissions that matter live.
 */
const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export async function capturePriceAction(locale: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!canWrite(session.role)) redirect(`/${locale}/prices/new?error=notAllowed`);

  try {
    await capturePrice({
      designation: str(form, "designation"),
      supplierName: str(form, "supplierName"),
      price: str(form, "price"),
      currency: str(form, "currency") || "DZD",
      // The tick says "TTC", because a shop's shelf price usually is.
      isExclVat: str(form, "incl") !== "on",
      // The tick says "I have the paper", because at a counter you usually
      // do not — so the default, unticked, is the verbal one.
      isVerbal: str(form, "written") !== "on",
      capturedPlace: str(form, "capturedPlace") || null,
      capturedFrom: str(form, "capturedFrom") || null,
      validUntil: str(form, "validUntil") || null,
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof PriceRefused) {
      redirect(`/${locale}/prices/new?error=${error.reason}`);
    }
    throw error;
  }

  revalidatePath(`/${locale}/prices/new`);
  redirect(`/${locale}/prices/new?saved=1`);
}
