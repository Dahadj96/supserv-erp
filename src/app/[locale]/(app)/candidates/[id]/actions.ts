"use server";

import { revalidatePath } from "next/cache";
import { canWrite } from "@/auth/can";
import { getSession } from "@/auth/session";
import {
  CertificationRefused,
  certificationInput,
  saveCertification,
  setCertificationVerified,
} from "@/domain/people";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 25 — the tickets.
 *
 * `canWrite`, the same gate as adding a person, and for the same reason: a
 * chef de chantier who has just been handed a welder's habilitation has to be
 * able to write it down. What it says is not a privileged fact; the salary is
 * the gated one, and it lives on the person, not here.
 */
function back(locale: string, id: string, query = "") {
  redirect({ href: `/candidates/${id}${query}`, locale });
}

export async function saveCertificationAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }
  if (!canWrite(session.role)) back(locale, id, "?error=notAllowed");

  const parsed = certificationInput.safeParse({
    kind: String(form.get("kind") ?? ""),
    number: String(form.get("number") ?? ""),
    issuedBy: String(form.get("issuedBy") ?? ""),
    issuedOn: String(form.get("issuedOn") ?? ""),
    expiresOn: String(form.get("expiresOn") ?? ""),
  });
  if (!parsed.success) {
    back(locale, id, `?error=${parsed.error.issues[0]?.message ?? "invalid"}`);
    return;
  }

  try {
    await saveCertification(id, parsed.data, session.userId);
  } catch (error) {
    if (error instanceof CertificationRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }

  revalidatePath(`/${locale}/candidates/${id}`);
  back(locale, id, "?recorded=certification");
}

/**
 * "I have seen the original", and the withdrawal of it.
 *
 * Both directions, because a confirmation given in error with no way back is
 * how a wrong fact becomes permanent. Both are in the audit trail.
 */
export async function verifyCertificationAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }
  if (!canWrite(session.role)) back(locale, id, "?error=notAllowed");

  try {
    await setCertificationVerified({
      certificationId: String(form.get("certificationId") ?? ""),
      verified: String(form.get("verified") ?? "") === "yes",
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof CertificationRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }

  revalidatePath(`/${locale}/candidates/${id}`);
  back(locale, id, "?recorded=checked");
}
