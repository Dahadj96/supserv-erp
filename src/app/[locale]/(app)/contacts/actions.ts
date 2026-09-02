"use server";

import { revalidatePath } from "next/cache";
import { canWrite } from "@/auth/can";
import { getSession } from "@/auth/session";
import { contactInput, createContact } from "@/domain/contact";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 76. Creating a contact needs no special permission — anybody who can
 * see the screen can write down a name they were given on the phone. It is the
 * lowest-stakes write in the system, and making it harder is how names end up
 * in a notebook instead.
 */
export async function newContact(locale: string, formData: FormData) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }
  if (!canWrite(session.role)) {
    redirect({ href: `/contacts/new?error=notAllowed`, locale });
    return;
  }

  const parsed = contactInput.safeParse({
    fullName: String(formData.get("fullName") ?? ""),
    job: String(formData.get("job") ?? ""),
    companyId: String(formData.get("companyId") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    prefers: String(formData.get("prefers") ?? ""),
  });

  if (!parsed.success) {
    // The field that failed, named, so the form can say which one rather than
    // reloading blank with a red border and no sentence.
    const first = parsed.error.issues[0];
    redirect({
      href: `/contacts/new?error=${first?.message ?? "invalid"}&field=${String(first?.path[0] ?? "")}`,
      locale,
    });
    return;
  }

  const companyId = parsed.data.companyId;
  await createContact(parsed.data, session.userId);

  revalidatePath(`/${locale}/contacts`);
  redirect({ href: `/companies/${companyId}`, locale });
}
