"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { BuildRefused, buildOffer } from "@/domain/offer/build";

/** Screen 06's "Build offer" button — the seam from enquiry to offer. */
export async function buildOfferAction(
  locale: string,
  dealId: string,
  form: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);

  const margin = String(form.get("marginPct") ?? "").trim();

  let offerId: string;
  try {
    offerId = await buildOffer({
      dealId,
      defaultMarginPct: margin && Number.isFinite(Number(margin)) ? margin : "20",
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof BuildRefused) redirect(`/${locale}/deals/${dealId}?error=${error.reason}`);
    throw error;
  }
  redirect(`/${locale}/offers/${offerId}/build`);
}
