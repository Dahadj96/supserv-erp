"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { mayIssue } from "@/auth/can";
import { getSession } from "@/auth/session";
import { db } from "@/db";
import { document } from "@/db/schema/document";
import { Blocked } from "@/documents/compliance";
import { fileDocument, NotRenderable, render } from "@/documents/engine";
import { toPdf } from "@/documents/pdf";
import { CannotIssueYet } from "@/domain/setup";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 18's one irreversible button.
 *
 * LAW 5 — after this returns, the document has a number and cannot be edited.
 * A correction is a new document. So everything that can refuse gets its chance
 * before the number is reserved, and the engine, not this action, is where that
 * happens: this file only decides who is allowed to ask.
 */

export async function issueDocument(locale: string, id: string) {
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

  if (!mayIssue(session.role, record.kind)) {
    redirect({ href: `/documents/${id}?error=notAllowed`, locale });
    return;
  }

  try {
    const issued = await render({ documentId: id, purpose: "issue", actorId: session.userId });

    // Step 7 of the engine, completed: the bytes exist, and the record links to
    // them. The PDF is produced from the SAME rendered object the number was
    // reserved for, so the file and the register can never disagree.
    if (issued.number) {
      try {
        await fileDocument(id, issued.number, await toPdf(issued));
      } catch {
        // Issuing is already committed and must never be rolled back or hidden.
        // Send the operator back to the document with a recovery action instead
        // of leaving an issued document behind a generic error page.
        redirect({ href: `/documents/${id}?error=filingFailed`, locale });
        return;
      }
    }
  } catch (error) {
    if (error instanceof Blocked) {
      const first = error.findings[0]?.code ?? "complianceBlocked";
      redirect({
        href: `/documents/${id}?error=blocked&rule=${encodeURIComponent(first)}`,
        locale,
      });
      return;
    }
    if (error instanceof CannotIssueYet) {
      redirect({ href: `/documents/${id}?error=setupIncomplete`, locale });
      return;
    }
    if (error instanceof NotRenderable) {
      redirect({ href: `/documents/${id}?error=${error.why}`, locale });
      return;
    }
    throw error;
  }

  revalidatePath(`/${locale}/documents/${id}`);
  redirect({ href: `/documents/${id}?issued=1`, locale });
}

/** Rebuild the deterministic archive copy from an issued document's snapshot. */
export async function fileIssuedDocument(locale: string, id: string) {
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
  if (!mayIssue(session.role, record.kind)) {
    redirect({ href: `/documents/${id}?error=notAllowed`, locale });
    return;
  }
  if (record.status !== "issued" || !record.number) {
    redirect({ href: `/documents/${id}?error=notIssued`, locale });
    return;
  }

  try {
    const rendered = await render({ documentId: id, purpose: "preview", actorId: session.userId });
    await fileDocument(id, record.number, await toPdf(rendered));
  } catch {
    redirect({ href: `/documents/${id}?error=filingFailed`, locale });
    return;
  }

  revalidatePath(`/${locale}/documents/${id}`);
  redirect({ href: `/documents/${id}?filed=1`, locale });
}
