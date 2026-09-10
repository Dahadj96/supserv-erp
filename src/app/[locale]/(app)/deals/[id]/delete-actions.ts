"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import type { RowDeleteDescription } from "@/components/ui/row-delete";
import {
  DealNotDiscardable,
  dealDiscardEffect,
  discardDeal,
  NotDiscardable,
  restoreDeal,
} from "@/domain/deletion";

/**
 * Screen 83, on an enquiry.
 *
 * Kept out of `actions.ts` for the same reason companies keep theirs apart:
 * deletion is its own permission, and a file that holds nothing else makes the
 * permission table in `tests/unit/action-permissions.test.ts` readable.
 */
async function requireDeleter(locale: string, id: string) {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!session.role || !can(session.role, "records.delete")) {
    redirect(`/${locale}/deals/${id}?error=notAllowed`);
  }
  return session;
}

export async function discardDealAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await requireDeleter(locale, id);
  try {
    await discardDeal({
      id,
      reason: String(form.get("reason") ?? ""),
      actorId: session.userId,
      fromWhere: "06",
    });
  } catch (error) {
    if (error instanceof NotDiscardable) {
      // The honest answer with a route, as on screen 22: it cannot go in the
      // bin, and the page says why rather than the button vanishing.
      //
      // V1 — and it names the paper. "This enquiry has 1 issued document" is a
      // sentence somebody then has to go and investigate; "FA-2026-0007 has
      // been issued" is one they can act on, and the correction for an issued
      // document is an avoir, which is a different button on a different screen.
      const named =
        error instanceof DealNotDiscardable
          ? error.documents
              .map((d) => d.number ?? d.kind)
              .slice(0, 3)
              .join(", ")
          : "";
      revalidatePath(`/${locale}/deals/${id}`);
      redirect(
        `/${locale}/deals/${id}?error=hasIssuedDocuments${named ? `&issued=${encodeURIComponent(named)}` : ""}`,
      );
    }
    throw error;
  }
  revalidatePath(`/${locale}/deals`);
  redirect(`/${locale}/deals`);
}

export async function restoreDealAction(locale: string, id: string): Promise<void> {
  const session = await requireDeleter(locale, id);
  await restoreDeal({ id, actorId: session.userId });
  revalidatePath(`/${locale}/deals`);
  redirect(`/${locale}/deals/${id}`);
}

/**
 * V2 — what the confirmation on the deals list says, before it says it.
 *
 * Asked when the panel opens, not for every row on the list: a hundred-row
 * list would otherwise run a hundred count queries to draw a hundred trash
 * icons nobody pressed.
 *
 * The refusal is computed HERE rather than being discovered by pressing the
 * button and reading a banner afterwards, which is the same rule the greyed
 * buttons on screen 22 follow: a control that can already know it will refuse
 * should say so while it is still grey. One query, one rule, and the panel and
 * the action cannot disagree because they call the same function.
 */
export async function describeDealDiscard(
  locale: string,
  id: string,
): Promise<RowDeleteDescription> {
  const session = await getSession();
  const t = await getTranslations({ locale });

  if (!session?.role || !can(session.role, "records.delete")) {
    return { takes: "", refusedBecause: t("deal.discard.notAllowed") };
  }

  const effect = await dealDiscardEffect(id);

  if (effect.issued.length > 0) {
    // The number when it has one. A client's bon de commande carries THEIR
    // reference and never takes one of ours, so it is named by what it is.
    const name = (d: { kind: string; number: string | null }) =>
      d.number ?? (t.has(`documents.kind.${d.kind}`) ? t(`documents.kind.${d.kind}`) : d.kind);

    return {
      takes: "",
      refusedBecause: t("deal.error.hasIssuedDocumentsNamed", {
        documents: effect.issued.slice(0, 3).map(name).join(", "),
      }),
    };
  }

  const takes = t("deal.discard.takesWithIt", {
    lines: effect.lines,
    drafts: effect.drafts.length,
    requests: effect.sourcingRequests,
  });

  return {
    takes: effect.hasTender ? `${takes} ${t("deal.discard.andTheTender")}` : takes,
  };
}

/**
 * The same discard, reached from the list rather than from the record.
 *
 * It exists separately only because of where it goes afterwards: from the
 * record you are standing on the thing you just binned and have to leave, and
 * from the list you are already where you should be.
 */
export async function discardDealFromListAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await requireDeleter(locale, id);
  try {
    await discardDeal({
      id,
      reason: String(form.get("reason") ?? ""),
      actorId: session.userId,
      fromWhere: "05",
    });
  } catch (error) {
    if (error instanceof NotDiscardable) {
      const named =
        error instanceof DealNotDiscardable
          ? error.documents
              .map((d) => d.number ?? d.kind)
              .slice(0, 3)
              .join(", ")
          : "";
      revalidatePath(`/${locale}/deals`);
      redirect(
        `/${locale}/deals?error=hasIssuedDocuments${named ? `&issued=${encodeURIComponent(named)}` : ""}`,
      );
    }
    throw error;
  }
  revalidatePath(`/${locale}/deals`);
  redirect(`/${locale}/deals?removed=${encodeURIComponent(id)}`);
}
