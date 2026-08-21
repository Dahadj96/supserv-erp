"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/auth/session";
import { createPerson, personInput } from "@/domain/people";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 51. Adding a person needs no permission — a chef de chantier who has
 * just hired three journaliers for the morning has to be able to write them
 * down. The salary is what is gated (`people.salary.view`), not the name.
 */
export async function addPerson(locale: string, formData: FormData) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }

  const parsed = personInput.safeParse({
    fullName: String(formData.get("fullName") ?? ""),
    trade: String(formData.get("trade") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    nationalId: String(formData.get("nationalId") ?? ""),
    wilaya: String(formData.get("wilaya") ?? ""),
    relationship: String(formData.get("relationship") ?? "daily"),
    employerPartyId: String(formData.get("employerPartyId") ?? ""),
    dailyRate: String(formData.get("dailyRate") ?? ""),
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    redirect({ href: `/people?error=${first?.message ?? "invalid"}`, locale });
    return;
  }

  await createPerson(parsed.data, session.userId);
  revalidatePath(`/${locale}/people`);
  redirect({ href: "/people", locale });
}
