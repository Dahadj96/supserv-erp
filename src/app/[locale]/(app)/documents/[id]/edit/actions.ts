"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { mayIssue } from "@/auth/can";
import { getSession } from "@/auth/session";
import { db } from "@/db";
import { document } from "@/db/schema/document";
import { type DraftLine, DraftRefused, type LineKind, saveDraft } from "@/documents/draft";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 47. The form posts lines; the server recomputes the totals. A total
 * that arrived over the wire is a total somebody could have edited.
 */

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function parseLines(form: FormData): DraftLine[] {
  const kinds = form.getAll("lineKind").map(String);
  const designations = form.getAll("designation").map(String);
  const references = form.getAll("reference").map(String);
  const units = form.getAll("unit").map(String);
  const quantities = form.getAll("qty").map(String);
  const prices = form.getAll("unitPrice").map(String);
  const discounts = form.getAll("discountPct").map(String);
  const rates = form.getAll("vatRate").map(String);
  // A checkbox posts nothing when unchecked, so the option flag travels as a
  // hidden field carrying its own row index rather than as a bare checkbox.
  const options = new Set(form.getAll("isOption").map(String));

  return kinds.map((lineKind, i) => ({
    lineKind: lineKind as LineKind,
    designation: designations[i] ?? "",
    reference: references[i] ?? null,
    unit: units[i] ?? null,
    qty: quantities[i] ?? null,
    unitPrice: prices[i] ?? null,
    discountPct: discounts[i] ?? null,
    vatRate: rates[i] ?? null,
    isOption: options.has(String(i)),
  }));
}

export async function saveDraftAction(locale: string, id: string, form: FormData) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }

  const [record] = await db.select().from(document).where(eq(document.id, id)).limit(1);
  if (!record) {
    redirect({ href: `/documents/${id}?error=noSuchDocument`, locale });
    return;
  }

  const nextKind = str(form, "kind") || record.kind;
  if (!mayIssue(session.role, record.kind) || !mayIssue(session.role, nextKind)) {
    redirect({ href: `/documents/${id}/edit?error=notAllowed`, locale });
    return;
  }

  try {
    await saveDraft(
      id,
      {
        kind: nextKind,
        issuedOn: str(form, "issuedOn") || null,
        globalDiscountPct: str(form, "globalDiscountPct") || "0",
        advanceDeducted: str(form, "advanceDeducted") || "0",
        retentionPct: str(form, "retentionPct") || "0",
        settlement: str(form, "settlement") || null,
        ...(form.has("theirNumber") ? { theirNumber: str(form, "theirNumber") || null } : {}),
        lines: parseLines(form),
      },
      session.userId,
    );
  } catch (error) {
    if (error instanceof DraftRefused) {
      redirect({ href: `/documents/${id}/edit?error=${error.reason}`, locale });
      return;
    }
    throw error;
  }

  revalidatePath(`/${locale}/documents/${id}`);

  if (str(form, "then") === "preview") {
    redirect({ href: `/documents/${id}`, locale });
    return;
  }
  redirect({ href: `/documents/${id}/edit?saved=1`, locale });
}
