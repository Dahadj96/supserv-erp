"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import {
  confirmAllHighConfidence,
  confirmField,
  ingestPdf,
  rejectField,
} from "@/domain/intake/dossier";
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

/** Screen 39 — a PDF arrives and is read. Nothing is decided by reading it. */
export async function uploadDossier(locale: string, formData: FormData) {
  const session = await requireUser(locale);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect({ href: "/inbox/dossier?error=noFile", locale });
    return;
  }

  const { dossierId } = await ingestPdf({
    filename: file.name,
    body: Buffer.from(await file.arrayBuffer()),
    actorId: session.userId,
  });

  redirect({ href: `/inbox/dossier/${dossierId}/review`, locale });
}
