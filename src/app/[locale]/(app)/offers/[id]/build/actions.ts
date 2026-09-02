"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { db } from "@/db";
import { document, documentLine } from "@/db/schema/document";
import { recomputeTotals } from "@/documents/totals";
import { applyMarginToAll, priceFromMargin } from "@/domain/offer/margin";
import { markSubmitted, OfferRefused } from "@/domain/offer/store";

/**
 * Screen 12's actions.
 *
 * `applyMargin` and the per-line price edit both refuse for anyone without
 * `offers.margin.view`. Not because the write is dangerous, but because setting
 * a price FROM a cost requires seeing the cost — and a screen that hides the
 * cost column while letting somebody reprice against it is a screen that lies
 * about what it is doing.
 */

function back(locale: string, id: string, query = ""): never {
  revalidatePath(`/${locale}/offers/${id}/build`);
  redirect(`/${locale}/offers/${id}/build${query}`);
}

export async function applyMarginAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session?.role) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "offers.margin.view")) back(locale, id, "?error=notAllowed");

  const pct = String(form.get("marginPct") ?? "").trim();
  if (!pct || !Number.isFinite(Number(pct))) back(locale, id, "?error=badMargin");

  const [doc] = await db.select().from(document).where(eq(document.id, id)).limit(1);
  if (!doc) back(locale, id, "?error=noSuchOffer");
  // LAW 5. An issued document is immutable; correction is a new document.
  if (doc.number) back(locale, id, "?error=alreadyIssued");

  const lines = await db.select().from(documentLine).where(eq(documentLine.documentId, id));
  const repriced = applyMarginToAll(
    lines.map((l) => ({
      id: l.id,
      unitCost: l.unitCost,
      unitPrice: l.unitPrice,
      qty: l.qty,
      lineKind: l.lineKind,
    })),
    pct,
  );

  for (const line of repriced) {
    await db
      .update(documentLine)
      .set({ unitPrice: line.unitPrice })
      .where(eq(documentLine.id, line.id));
  }
  await recomputeTotals(id);

  back(locale, id, "?applied=1");
}

/** One line's price, or its margin — whichever the person typed. */
export async function setLineAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session?.role) redirect(`/${locale}/sign-in`);

  const lineId = String(form.get("lineId") ?? "");
  const price = String(form.get("unitPrice") ?? "").trim();
  const pct = String(form.get("marginPct") ?? "").trim();

  const [doc] = await db.select().from(document).where(eq(document.id, id)).limit(1);
  if (!doc) back(locale, id, "?error=noSuchOffer");
  if (doc.number) back(locale, id, "?error=alreadyIssued");

  const [line] = await db.select().from(documentLine).where(eq(documentLine.id, lineId)).limit(1);
  if (!line || line.documentId !== id) back(locale, id, "?error=noSuchLine");

  let unitPrice: string | null = null;
  if (price) {
    unitPrice = price.replace(/[\s ]/g, "").replace(",", ".");
  } else if (pct) {
    // Setting a price from a margin needs the cost, so it needs the permission
    // to see the cost.
    if (!can(session.role, "offers.margin.view")) back(locale, id, "?error=notAllowed");
    if (!line.unitCost) back(locale, id, "?error=noCost");
    unitPrice = priceFromMargin(line.unitCost, pct);
  } else {
    back(locale, id);
  }

  await db.update(documentLine).set({ unitPrice }).where(eq(documentLine.id, lineId));
  await recomputeTotals(id);
  back(locale, id, "?saved=1");
}

export async function markSubmittedAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);

  const when = String(form.get("when") ?? "").trim();

  try {
    await markSubmitted({
      offerId: id,
      place: String(form.get("place") ?? "").trim() || null,
      proofRef: String(form.get("proofRef") ?? "").trim() || null,
      when: when ? new Date(when) : new Date(),
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof OfferRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }
  back(locale, id, "?submitted=1");
}
