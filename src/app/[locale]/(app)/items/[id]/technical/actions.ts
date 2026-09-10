"use server";

import { revalidatePath } from "next/cache";
import { canWrite } from "@/auth/can";
import { getSession } from "@/auth/session";
import { addItemMedia, MediaRefused } from "@/domain/item-technical";
import { redirect } from "@/i18n/navigation";

/** Anything that is not one is not a deal, and is dropped rather than trusted. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Screen 77 — attaching a datasheet.
 *
 * `canWrite`, the same gate as writing down a person or a price: a
 * manufacturer's PDF for a cable is a record, not correspondence and not cost.
 * The two read gates this ERP has are `inbox.view` and `offers.margin.view`,
 * and a fiche technique is neither — `src/domain/files/serving.ts` says so
 * where it decides who may fetch the bytes back.
 */
export async function addMediaAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }

  /*
   * V0 — the enquiry travels with the upload.
   *
   * `item_media.deal_id` exists so that "a picture the client sent belongs to
   * that enquiry" is recordable, and NOTHING was writing it: every upload
   * landed item-wide with no idea which tender it was gathered for. The form
   * carries the deal it came from, and the redirect carries it back so the
   * person stays where they were.
   */
  const rawDeal = String(form.get("dealId") ?? "").trim();
  const dealId = UUID.test(rawDeal) ? rawDeal : null;
  const keep = dealId ? `deal=${dealId}` : "";

  const back = (query: string) =>
    redirect({
      href: `/items/${id}/technical${query}${query && keep ? `&${keep}` : keep ? `?${keep}` : ""}`,
      locale,
    });

  if (!canWrite(session.role)) {
    back("?error=notAllowed");
    return;
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    back("?error=empty");
    return;
  }

  try {
    await addItemMedia({
      itemId: id,
      filename: file.name,
      contentType: file.type || null,
      bytes: Buffer.from(await file.arrayBuffer()),
      mediaKind: String(form.get("mediaKind") ?? ""),
      provenance: String(form.get("provenance") ?? ""),
      capturedAtPlace: String(form.get("capturedAtPlace") ?? ""),
      dealId,
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof MediaRefused) {
      back(`?error=${error.reason}`);
      return;
    }
    throw error;
  }

  revalidatePath(`/${locale}/items/${id}/technical`);
  back("?recorded=media");
}
