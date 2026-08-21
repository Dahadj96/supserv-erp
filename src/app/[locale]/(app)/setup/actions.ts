"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { addBankAccount, addSeries, addVatRate, saveIdentity, setLogo } from "@/domain/company";
import { redirect } from "@/i18n/navigation";
import { storageFor } from "@/storage";

/**
 * Screen 85. All of this is `settings.company` — the Gérant. These are the
 * values every document in the system will carry, and the screen says so:
 * "Nothing else in the system can be trusted if these are wrong."
 */
async function requireOwner(locale: string) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    throw new Error("unreachable");
  }
  if (!session.role || !can(session.role, "settings.company")) throw new Error("notAllowed");
  return session;
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

export async function saveCompanyIdentity(locale: string, formData: FormData) {
  const session = await requireOwner(locale);

  const parsed = {
    legalName: text(formData, "legalName"),
    tradeName: text(formData, "tradeName"),
    legalForm: text(formData, "legalForm"),
    capital: text(formData, "capital"),
    rc: text(formData, "rc"),
    nif: text(formData, "nif"),
    nis: text(formData, "nis"),
    ai: text(formData, "ai"),
    address: text(formData, "address"),
    wilaya: text(formData, "wilaya"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    website: text(formData, "website"),
  };

  try {
    await saveIdentity(parsed, session.userId);
  } catch (error) {
    const issue =
      error instanceof Error && "issues" in error
        ? (error as { issues: { message: string }[] }).issues[0]?.message
        : "invalid";
    redirect({ href: `/setup/identity?error=${issue ?? "invalid"}`, locale });
    return;
  }

  // The logo is part of the same form: a letterhead with an address and no
  // logo is not a letterhead anybody sends.
  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    const path = `company/logo-${Date.now()}-${logo.name.replace(/[^\w.-]+/g, "_")}`;
    await storageFor("working").put({
      path,
      body: Buffer.from(await logo.arrayBuffer()),
      mime: logo.type || "image/png",
    });
    await setLogo(path, session.userId);
  }

  revalidatePath(`/${locale}/setup`);
  redirect({ href: "/setup?saved=identity", locale });
}

export async function saveVatRate(locale: string, formData: FormData) {
  const session = await requireOwner(locale);
  try {
    await addVatRate(
      {
        rate: text(formData, "rate"),
        kind: text(formData, "kind") as "normal" | "reduced" | "exempt",
        startsOn: text(formData, "startsOn"),
        authority: text(formData, "authority"),
      },
      session.userId,
    );
  } catch {
    redirect({ href: "/setup/vat?error=invalid", locale });
    return;
  }
  revalidatePath(`/${locale}/setup`);
  redirect({ href: "/setup/vat?saved=1", locale });
}

export async function saveSeries(locale: string, formData: FormData) {
  const session = await requireOwner(locale);
  try {
    await addSeries(
      {
        kind: text(formData, "kind"),
        pattern: text(formData, "pattern"),
        reset: (text(formData, "reset") || "yearly") as "yearly" | "never",
      },
      session.userId,
    );
  } catch (error) {
    const issue =
      error instanceof Error && "issues" in error
        ? (error as { issues: { message: string }[] }).issues[0]?.message
        : "invalid";
    redirect({ href: `/setup/numbering?error=${issue ?? "invalid"}`, locale });
    return;
  }
  revalidatePath(`/${locale}/setup`);
  redirect({ href: "/setup/numbering?saved=1", locale });
}

export async function saveBank(locale: string, formData: FormData) {
  const session = await requireOwner(locale);
  try {
    await addBankAccount(
      {
        bankName: text(formData, "bankName"),
        agency: text(formData, "agency"),
        rib: text(formData, "rib"),
        iban: text(formData, "iban"),
        swift: text(formData, "swift"),
        currency: text(formData, "currency") || "DZD",
      },
      session.userId,
    );
  } catch (error) {
    const issue =
      error instanceof Error && "issues" in error
        ? (error as { issues: { message: string }[] }).issues[0]?.message
        : "invalid";
    redirect({ href: `/setup/bank?error=${issue ?? "invalid"}`, locale });
    return;
  }
  revalidatePath(`/${locale}/setup`);
  redirect({ href: "/setup/bank?saved=1", locale });
}
