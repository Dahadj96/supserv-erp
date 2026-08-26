"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { addQuote, PriceRefused } from "@/domain/deal/price-store";

/** Screen 74's "Save this price". One door in, one refusal a person can read. */
export async function addPriceAction(
  locale: string,
  dealId: string,
  form: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);

  const source = String(form.get("source") ?? "");
  const written = String(form.get("written") ?? "");

  try {
    await addQuote({
      dealId,
      dealLineId: String(form.get("dealLineId") ?? "") || null,
      source,
      supplierName: String(form.get("supplierName") ?? "") || null,
      price: String(form.get("price") ?? ""),
      currency: String(form.get("currency") ?? "DZD"),
      // Suppliers quote both ways and the difference is nineteen per cent,
      // which is the whole margin. Asked, never assumed.
      isExclVat: written !== "incl",
      isVerbal: String(form.get("firmness") ?? "") === "verbal",
      validUntil: String(form.get("validUntil") ?? "") || null,
      capturedPlace: String(form.get("capturedPlace") ?? "") || null,
      capturedFrom: String(form.get("capturedFrom") ?? "") || null,
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof PriceRefused) {
      revalidatePath(`/${locale}/deals/${dealId}/prices`);
      redirect(`/${locale}/deals/${dealId}/prices?error=${error.reason}`);
    }
    throw error;
  }

  revalidatePath(`/${locale}/deals/${dealId}/prices`);
  redirect(`/${locale}/deals/${dealId}/prices?saved=1`);
}
