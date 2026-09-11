"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canWrite } from "@/auth/can";
import { getSession } from "@/auth/session";
import { createItemFromLine, MatchRefused, matchLine } from "@/domain/item-technical";

/**
 * Matching a line to the catalogue — `canWrite`, the same gate as writing the
 * line down in the first place. Saying "this is that article" is a claim a
 * person makes, and it is recorded with their name; it is not a permission to
 * hold back from whoever typed the line.
 */
async function writer(locale: string, dealId: string) {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!canWrite(session.role)) redirect(`/${locale}/deals/${dealId}/items?error=notAllowed`);
  return session;
}

export async function matchLineAction(
  locale: string,
  dealId: string,
  lineId: string,
  form: FormData,
): Promise<void> {
  const session = await writer(locale, dealId);
  const itemId = String(form.get("itemId") ?? "").trim() || null;
  const way = String(form.get("way") ?? "").trim();

  try {
    await matchLine({
      dealId,
      lineId,
      itemId,
      way: way === "exact_code" || way === "alias" || way === "designation" ? way : null,
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof MatchRefused) {
      redirect(`/${locale}/deals/${dealId}/items/${lineId}/match?error=${error.reason}`);
    }
    throw error;
  }

  revalidatePath(`/${locale}/deals/${dealId}/items`);
  revalidatePath(`/${locale}/items`);
  redirect(`/${locale}/deals/${dealId}/items?matched=${itemId ? "1" : "0"}`);
}

export async function createItemFromLineAction(
  locale: string,
  dealId: string,
  lineId: string,
  form: FormData,
): Promise<void> {
  const session = await writer(locale, dealId);
  const kind = String(form.get("kind") ?? "good") === "service" ? "service" : "good";

  let itemId: string;
  try {
    itemId = await createItemFromLine({
      dealId,
      lineId,
      kind,
      // Cable, boulonnerie, main-d'oeuvre: no manufacturer publishes a
      // datasheet, so the catalogue must be able to say "complete" rather than
      // nagging for a fiche technique that does not exist.
      isGeneric: form.get("isGeneric") === "on",
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof MatchRefused) {
      redirect(`/${locale}/deals/${dealId}/items/${lineId}/match?error=${error.reason}`);
    }
    throw error;
  }

  revalidatePath(`/${locale}/deals/${dealId}/items`);
  revalidatePath(`/${locale}/items`);
  // Straight to the new article's technical file, carrying the enquiry — the
  // reason somebody matched a line is usually that they need to put a fiche
  // technique on it.
  redirect(`/${locale}/items/${itemId}/technical?deal=${dealId}`);
}
