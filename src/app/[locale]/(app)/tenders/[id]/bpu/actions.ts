"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { type BpuKind, BpuUnreadable, commitBpuBatch, previewBpu } from "@/domain/tender/bpu-batch";
import { BPU_TARGETS, type BpuMapping, type BpuTarget } from "@/domain/tender/bpu-columns";
import {
  applyLastPrices,
  applyPendingErratum,
  BpuRefused,
  bpu,
  discardErratum,
} from "@/domain/tender/bpu-store";

/**
 * Screen 42's actions.
 *
 * Nothing here sets a selling price. `our price` on this screen is READ from
 * the draft offer, and the offer builder is where it is set — screen 12 already
 * owns that, with `offers.margin.view` on it, and a second place to type a
 * price is a second place for the two to disagree.
 */

function back(locale: string, id: string, query = ""): never {
  revalidatePath(`/${locale}/tenders/${id}/bpu`);
  redirect(`/${locale}/tenders/${id}/bpu${query}`);
}

async function requirePricer(locale: string, id: string) {
  const session = await getSession();
  if (!session?.role) redirect(`/${locale}/sign-in`);
  // Pricing a bordereau is reading costs. The permission is the one that guards
  // the cost column, because doing this without seeing costs is not something
  // the screen can offer honestly.
  if (!can(session.role, "offers.margin.view")) back(locale, id, "?error=notAllowed");
  return session;
}

function mappingFrom(form: FormData): BpuMapping {
  const mapping: BpuMapping = {};
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("column:")) continue;
    const heading = key.slice("column:".length);
    const target = String(value);
    mapping[heading] = (BPU_TARGETS as readonly string[]).includes(target)
      ? (target as BpuTarget)
      : null;
  }
  return mapping;
}

/** Step 1 — read the sheet and show what it would do. Writes no lines. */
export async function uploadBpuAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await requirePricer(locale, id);

  const kind: BpuKind =
    String(form.get("kind") ?? "deal_line") === "bpu_erratum" ? "bpu_erratum" : "deal_line";

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) back(locale, id, "?error=noFile");

  const view = await bpu(id);
  if (!view) back(locale, id, "?error=noSuchDeal");
  if (kind === "deal_line" && view.rows.length > 0) back(locale, id, "?error=alreadyImported");
  if (kind === "bpu_erratum" && view.rows.length === 0) {
    back(locale, id, "?error=nothingImportedYet");
  }

  let batchId: string;
  try {
    const preview = await previewBpu({
      dealId: id,
      partyId: view.partyId,
      kind,
      filename: file.name,
      body: Buffer.from(await file.arrayBuffer()),
      actorId: session.userId,
    });
    batchId = preview.batchId;
  } catch (error) {
    back(locale, id, `?error=${error instanceof BpuUnreadable ? error.reason : "unreadable"}`);
  }

  back(locale, id, `?batch=${batchId}&tab=mapping`);
}

/** Step 2 — the mapping a person confirmed, applied to the same bytes. */
export async function confirmMappingAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await requirePricer(locale, id);

  const batchId = String(form.get("batchId") ?? "");
  if (!batchId) back(locale, id, "?error=noBatch");

  const view = await bpu(id);
  if (!view) back(locale, id, "?error=noSuchDeal");

  try {
    const { kind, lines, problems } = await commitBpuBatch({
      batchId,
      partyId: view.partyId,
      mapping: mappingFrom(form),
      actorId: session.userId,
      receivedOn: String(form.get("receivedOn") ?? "").trim() || null,
    });
    back(
      locale,
      id,
      kind === "deal_line"
        ? `?imported=${lines.length}&skipped=${problems.length}`
        : "?erratum=1&tab=erratum",
    );
  } catch (error) {
    if (error instanceof BpuUnreadable || error instanceof BpuRefused) {
      back(locale, id, `?error=${error.reason}&batch=${batchId}&tab=mapping`);
    }
    throw error;
  }
}

/** The banner's offer: cost the lines we have bought before from what we paid. */
export async function applyLastPricesAction(locale: string, id: string): Promise<void> {
  const session = await requirePricer(locale, id);
  try {
    const { applied } = await applyLastPrices({ dealId: id, actorId: session.userId });
    back(locale, id, `?costed=${applied}`);
  } catch (error) {
    if (error instanceof BpuRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }
}

/** Move the lines. Refused over an issued offer unless somebody says so in writing. */
export async function applyErratumAction(locale: string, id: string, form: FormData) {
  const session = await requirePricer(locale, id);

  try {
    const result = await applyPendingErratum({
      erratumId: String(form.get("erratumId") ?? ""),
      actorId: session.userId,
      reason: String(form.get("reason") ?? "").trim() || null,
      acknowledgeIssued: form.get("acknowledgeIssued") === "on",
    });
    back(
      locale,
      id,
      `?applied=${result.added + result.removed + result.updated}&expired=${result.quotesExpired}`,
    );
  } catch (error) {
    if (error instanceof BpuRefused) back(locale, id, `?error=${error.reason}&tab=erratum`);
    throw error;
  }
}

/** Withdrawn by the buyer, or superseded. The row stays; the reason says why. */
export async function discardErratumAction(locale: string, id: string, form: FormData) {
  const session = await requirePricer(locale, id);

  try {
    await discardErratum({
      erratumId: String(form.get("erratumId") ?? ""),
      actorId: session.userId,
      reason: String(form.get("reason") ?? ""),
    });
    back(locale, id, "?discarded=1");
  } catch (error) {
    if (error instanceof BpuRefused) back(locale, id, `?error=${error.reason}&tab=erratum`);
    throw error;
  }
}
