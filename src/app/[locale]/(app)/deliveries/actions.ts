"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import {
  CannotDeliver,
  recordSignedCopy,
  saveDetail,
  startDelivery,
} from "@/domain/delivery/store";
import { redirect } from "@/i18n/navigation";

/**
 * Screens 49 and 14.
 *
 * Nothing here issues a bon de livraison. `startDelivery` creates a draft with
 * no number, and issuing goes through the one document engine on screen 18, the
 * same as every other document — LAW 3 and LAW 5, and the reason there is no
 * "issue the BL" action in this file.
 */

export async function startDeliveryAction(locale: string, sourceId: string, form: FormData) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }
  if (!can(session.role, "deliveries.issue")) {
    redirect({ href: `/deliveries?error=notAllowed`, locale });
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
    id = await startDelivery({
      sourceId,
      quantities,
      deliverOn: String(form.get("deliverOn") ?? ""),
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof CannotDeliver) {
      redirect({ href: `/deliveries/new?source=${sourceId}&error=${error.why}`, locale });
      return;
    }
    throw error;
  }

  redirect({ href: `/deliveries/${id}`, locale });
}

export async function saveDetailAction(locale: string, id: string, form: FormData) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }
  if (!can(session.role, "deliveries.issue")) {
    redirect({ href: `/deliveries?error=notAllowed`, locale });
    return;
  }

  const text = (name: string) => String(form.get(name) ?? "").trim() || null;
  const num = (name: string) => {
    const raw = String(form.get(name) ?? "")
      .replace(/\s/g, "")
      .replace(",", ".");
    return raw && Number.isFinite(Number(raw)) ? raw : null;
  };

  await saveDetail({
    documentId: id,
    patch: {
      packages: num("packages") === null ? null : Number(num("packages")),
      grossWeightKg: num("grossWeightKg"),
      volumeM3: num("volumeM3"),
      carrier: text("carrier"),
      vehicle: text("vehicle"),
      driver: text("driver"),
      deliveryAddress: text("deliveryAddress"),
      siteContactName: text("siteContactName"),
    },
    actorId: session.userId,
  });

  revalidatePath(`/${locale}/deliveries/${id}`);
  redirect({ href: `/deliveries/${id}?saved=1`, locale });
}

/**
 * The signed copy came back.
 *
 * Written once. A second signing would overwrite the record of the first, and
 * in a dispute the first is the record that matters.
 */
export async function signAction(locale: string, id: string, form: FormData) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }
  if (!can(session.role, "deliveries.issue")) {
    redirect({ href: `/deliveries?error=notAllowed`, locale });
    return;
  }

  try {
    await recordSignedCopy({
      documentId: id,
      receivedBy: String(form.get("receivedBy") ?? ""),
      receivedOn: String(form.get("receivedOn") ?? "") || null,
      reserves: String(form.get("reserves") ?? ""),
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof CannotDeliver) {
      redirect({ href: `/deliveries/${id}?error=${error.why}`, locale });
      return;
    }
    throw error;
  }

  revalidatePath(`/${locale}/deliveries`);
  redirect({ href: `/deliveries/${id}?signed=1`, locale });
}
