"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { createProject, ProjectRefused } from "@/domain/project/store";

/**
 * Screen 15's one write: open a project on an enquiry the client said yes to.
 *
 * `works.issue` is the site side's permission — the chef de chantier and the
 * commercial open projects; compta reads them.
 */

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const num = (form: FormData, key: string) => str(form, key).replace(/[\s ]/g, "").replace(",", ".");
const orNull = (value: string) => (value ? value : null);

export async function openProjectAction(locale: string, form: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const dealId = str(form, "dealId");
  if (!can(session.role, "works.issue")) {
    redirect(`/${locale}/projects/new?deal=${dealId}&error=notAllowed`);
  }

  const warranty = str(form, "warrantyMonths");
  let projectId: string;
  try {
    projectId = await createProject({
      dealId,
      object: str(form, "object"),
      contractRef: orNull(str(form, "contractRef")),
      wilaya: orNull(str(form, "wilaya")),
      amountExcl: orNull(num(form, "amountExcl")),
      startedOn: orNull(str(form, "startedOn")),
      contractualEnd: orNull(str(form, "contractualEnd")),
      retentionPct: num(form, "retentionPct") || "0",
      retentionBase: orNull(str(form, "retentionBase")),
      warrantyMonths: warranty ? Number(warranty) : null,
      contractDocumentId: orNull(str(form, "contractDocumentId")),
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof ProjectRefused) {
      redirect(`/${locale}/projects/new?deal=${dealId}&error=${error.reason}`);
    }
    throw error;
  }

  revalidatePath(`/${locale}/projects`);
  revalidatePath(`/${locale}/deals/${dealId}`);
  redirect(`/${locale}/projects/${projectId}?opened=1`);
}
