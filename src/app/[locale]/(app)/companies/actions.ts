"use server";

import { revalidatePath } from "next/cache";
import { canWrite } from "@/auth/can";
import { getSession } from "@/auth/session";
import { addAlias, createParty, type PartyInput, partyInput, updateParty } from "@/domain/party";
import { redirect } from "@/i18n/navigation";

/**
 * Lecture seule means read-only. PLAN §5 lists no "create a record" permission
 * because every role except that one has it.
 *
 * This used to test `session.role === "lecture"` itself, which was the same
 * rule written down twice — `canWrite` is where "who may write" is decided,
 * and a second copy of it is a second thing to remember when a role is added.
 */
async function requireWriter(locale: string) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    throw new Error("unreachable");
  }
  if (!canWrite(session.role)) {
    throw new Error("readOnly");
  }
  return session;
}

function parseForm(formData: FormData): PartyInput {
  return partyInput.parse({
    legalName: String(formData.get("legalName") ?? ""),
    tradeName: String(formData.get("tradeName") ?? ""),
    roles: formData.getAll("roles").map(String),
    nif: String(formData.get("nif") ?? ""),
    nis: String(formData.get("nis") ?? ""),
    rc: String(formData.get("rc") ?? ""),
    ai: String(formData.get("ai") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    address: String(formData.get("address") ?? ""),
    wilaya: String(formData.get("wilaya") ?? ""),
    docLocale: (String(formData.get("docLocale") ?? "fr") as "fr" | "en") ?? "fr",
    emailLocale: (String(formData.get("emailLocale") ?? "fr") as "fr" | "en") ?? "fr",
    currency: String(formData.get("currency") ?? "DZD"),
    paymentTerms: String(formData.get("paymentTerms") ?? ""),
  });
}

export async function createCompany(locale: string, formData: FormData) {
  const session = await requireWriter(locale);
  const created = await createParty(parseForm(formData), session.userId);
  revalidatePath(`/${locale}/companies`);
  redirect({ href: `/companies/${created.id}`, locale });
}

export async function updateCompany(locale: string, id: string, formData: FormData) {
  const session = await requireWriter(locale);
  await updateParty(id, parseForm(formData), session.userId);
  revalidatePath(`/${locale}/companies/${id}`);
  redirect({ href: `/companies/${id}`, locale });
}

export async function addCompanyAlias(locale: string, id: string, formData: FormData) {
  const session = await requireWriter(locale);
  await addAlias(id, String(formData.get("alias") ?? ""), session.userId);
  revalidatePath(`/${locale}/companies/${id}`);
}
