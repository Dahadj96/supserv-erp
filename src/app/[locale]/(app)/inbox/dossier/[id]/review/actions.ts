"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import {
  confirmAllHighConfidence,
  confirmField,
  ingestDocument,
  rejectField,
  UnreadableKind,
} from "@/domain/intake/dossier";
import { commitDossierToDeal, NoDealForDossier } from "@/domain/intake/dossier-commit";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 40. Confirming a field needs no special permission — the person doing
 * it is the person who read the page. What the confirmed fields later BECOME is
 * gated on the record type they create, which is a different screen's problem.
 */
async function requireUser(locale: string) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    throw new Error("unreachable");
  }
  if (!can(session.role, "inbox.view")) {
    redirect({ href: `/inbox/dossier?error=notAllowed`, locale });
    throw new Error("unreachable");
  }
  return session;
}

export async function confirm(
  locale: string,
  dossierId: string,
  fieldId: string,
  formData: FormData,
) {
  const session = await requireUser(locale);
  await confirmField({
    fieldId,
    actorId: session.userId,
    correctedTo: String(formData.get("value") ?? ""),
  });
  revalidatePath(`/${locale}/inbox/dossier/${dossierId}/review`);
}

export async function reject(locale: string, dossierId: string, fieldId: string) {
  const session = await requireUser(locale);
  await rejectField(fieldId, session.userId);
  revalidatePath(`/${locale}/inbox/dossier/${dossierId}/review`);
}

export async function confirmAll(locale: string, dossierId: string) {
  const session = await requireUser(locale);
  const { confirmed } = await confirmAllHighConfidence(dossierId, session.userId);
  revalidatePath(`/${locale}/inbox/dossier/${dossierId}/review`);
  redirect({ href: `/inbox/dossier/${dossierId}/review?confirmed=${confirmed}`, locale });
}

/**
 * Carry the confirmed fields onto the deal — the last arrow in the pipeline.
 *
 * `offers.issue` on top of `inbox.view`, and that is the point of the sentence
 * at the top of this file: confirming a reading is the work of whoever read the
 * page, but this WRITES ON A DEAL, so it is gated where the record lives. A
 * server action is a public endpoint; a person allowed to triage the inbox and
 * not to commit a deal must not be able to set its submission deadline by
 * posting to this one.
 *
 * The same permission 2.1 chose for "Make this a tender", deliberately: both
 * change what the company is committing itself to on a deal, and inventing a
 * second permission for the second one would be two names for one decision.
 */
export async function carryToDeal(locale: string, dossierId: string, formData: FormData) {
  const session = await requireUser(locale);
  if (!can(session.role, "offers.issue")) {
    redirect({ href: `/inbox/dossier/${dossierId}/review?error=notAllowed`, locale });
    return;
  }

  const dealId = String(formData.get("dealId") ?? "").trim();
  if (!dealId) {
    redirect({ href: `/inbox/dossier/${dossierId}/review?error=noDeal`, locale });
    return;
  }

  try {
    await commitDossierToDeal({ dossierId, dealId, actorId: session.userId });
  } catch (error) {
    if (error instanceof NoDealForDossier) {
      redirect({ href: `/inbox/dossier/${dossierId}/review?error=noDeal`, locale });
      return;
    }
    throw error;
  }

  revalidatePath(`/${locale}/inbox/dossier/${dossierId}/review`);
  revalidatePath(`/${locale}/deals/${dealId}`);
  redirect({ href: `/inbox/dossier/${dossierId}/review?carried=1`, locale });
}

/**
 * Screen 39 — a document arrives and is read. Nothing is decided by reading it.
 *
 * A PDF, a Word file or a spreadsheet since 1.6: a CCTP is very often a .docx
 * and a supplier's price list is nearly always an .xlsx, and the text is in
 * both of them.
 */
export async function uploadDossier(locale: string, formData: FormData) {
  const session = await requireUser(locale);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect({ href: "/inbox/dossier?error=noFile", locale });
    return;
  }

  let dossierId: string;
  try {
    ({ dossierId } = await ingestDocument({
      filename: file.name,
      body: Buffer.from(await file.arrayBuffer()),
      mime: file.type || null,
      actorId: session.userId,
    }));
  } catch (error) {
    // A kind nothing here can read writes no row and stores no bytes, so the
    // person is sent back with the reason rather than to a dossier that failed.
    if (error instanceof UnreadableKind) {
      redirect({ href: "/inbox/dossier?error=unreadableKind", locale });
      return;
    }
    throw error;
  }

  redirect({ href: `/inbox/dossier/${dossierId}/review`, locale });
}
