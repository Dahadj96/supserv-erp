"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Blocked } from "@/documents/compliance";
import { CannotCredit, cancelByCreditNote } from "@/documents/credit";
import { fileDocument, NotRenderable } from "@/documents/engine";
import { NoSeries } from "@/documents/numbering";
import { toPdf } from "@/documents/pdf";
import { CannotIssueYet } from "@/domain/setup";

/**
 * Screen 18 — the other irreversible button, and the one LAW 5 names.
 *
 * Its own file, beside `delete-actions.ts`, for the same reason that one is
 * separate: cancelling is its own permission and a file holding nothing else
 * keeps the table in `tests/unit/action-permissions.test.ts` readable.
 *
 * `invoices.cancel` and not `*issue`. The two are different questions —
 * `invoices.issue` asks who may put a facture into the world, `invoices.cancel`
 * asks who may say one of them is void — and the roles differ: `compta` issues
 * invoices, only the Gérant cancels one. Checking the stricter of the two is
 * checking both, since every role that holds `invoices.cancel` also holds
 * `invoices.issue`; that is asserted in `tests/unit/issue-permission.test.ts`.
 *
 * Until 8 September 2026 `invoices.cancel` was granted to `gerant` and
 * referenced exactly once in the whole repository — its own declaration. This
 * is the reference that makes it mean something.
 */
/**
 * Each refusal, in the words screen 18 prints.
 *
 * Mapped rather than passed straight through, because `notIssued` already
 * means something else on this page — "only an issued document can be filed",
 * from the filing action — and two refusals sharing a message key is how a
 * person is told the wrong thing about the right failure.
 */
const CANCEL_ERROR: Record<CannotCredit["why"], string> = {
  noSuchDocument: "noSuchDocument",
  notIssued: "cancelNotIssued",
  kindCannotBeCredited: "cancelWrongKind",
  alreadyCredited: "cancelAlreadyCredited",
  reasonRequired: "cancelReasonRequired",
  nothingToCopy: "cancelNothingToCopy",
};

export async function cancelByAvoirAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!session.role || !can(session.role, "invoices.cancel")) {
    redirect(`/${locale}/documents/${id}?error=notAllowedToCancel`);
  }

  let creditNoteId: string;
  try {
    const result = await cancelByCreditNote({
      documentId: id,
      reason: String(form.get("reason") ?? ""),
      actorId: session.userId,
    });
    creditNoteId = result.creditNoteId;

    // Step 7 of the engine, completed for the avoir exactly as `issueDocument`
    // completes it for an invoice: the bytes are made from the SAME rendered
    // object the number was reserved for, so the file and the register can
    // never disagree.
    if (result.number) {
      try {
        await fileDocument(creditNoteId, result.number, await toPdf(result.rendered));
      } catch {
        // The avoir is issued and the invoice is credited. Neither may be
        // rolled back, so the operator is sent to the avoir with the recovery
        // action already on it rather than to a generic error page.
        redirect(`/${locale}/documents/${creditNoteId}?error=filingFailed`);
      }
    }
  } catch (error) {
    if (error instanceof CannotCredit) {
      redirect(`/${locale}/documents/${id}?error=${CANCEL_ERROR[error.why]}`);
    }
    // The avoir could not be ISSUED, so nothing was credited — see the note on
    // the order of operations in `cancelByCreditNote`. The draft avoir it left
    // behind is linked to the invoice and reachable from this page.
    if (error instanceof NoSeries) {
      redirect(`/${locale}/documents/${id}?error=noCreditNoteSeries`);
    }
    if (error instanceof CannotIssueYet) {
      redirect(`/${locale}/documents/${id}?error=setupIncomplete`);
    }
    if (error instanceof Blocked) {
      const first = error.findings[0]?.code ?? "complianceBlocked";
      redirect(`/${locale}/documents/${id}?error=blocked&rule=${encodeURIComponent(first)}`);
    }
    if (error instanceof NotRenderable) {
      redirect(`/${locale}/documents/${id}?error=${error.why}`);
    }
    throw error;
  }

  revalidatePath(`/${locale}/documents/${id}`);
  revalidatePath(`/${locale}/invoices`);
  revalidatePath(`/${locale}/payments`);
  // The avoir is the new paper and the one somebody needs to look at.
  redirect(`/${locale}/documents/${creditNoteId}?issued=1`);
}
