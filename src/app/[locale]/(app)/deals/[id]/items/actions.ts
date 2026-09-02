"use server";

import { revalidatePath } from "next/cache";
import { canWrite } from "@/auth/can";
import { getSession } from "@/auth/session";
import { LinesRefused, replaceLines } from "@/domain/deal/lines";
import { parsePaste } from "@/domain/deal/paste";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 73 — correcting the item list of an enquiry that already exists.
 *
 * The paste is re-read on the SERVER, not trusted from the browser. What the
 * browser showed is what a person saw; it is not evidence of what the text
 * says, and a line array arriving from a client is a line array somebody can
 * edit. Same rule as screen 06 and screen 61, and it is why this action takes
 * raw text rather than rows.
 */
export async function replaceLinesAction(locale: string, dealId: string, form: FormData) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }
  if (!canWrite(session.role)) {
    redirect({ href: `/deals/${dealId}/items?error=notAllowed`, locale });
    return;
  }

  const read = parsePaste(String(form.get("paste") ?? ""));

  try {
    await replaceLines({ dealId, lines: read.lines, actorId: session.userId });
    revalidatePath(`/${locale}/deals/${dealId}/items`);
    redirect({ href: `/deals/${dealId}/items?saved=${read.lines.length}`, locale });
  } catch (error) {
    if (error instanceof LinesRefused) {
      redirect({ href: `/deals/${dealId}/items?error=${error.reason}`, locale });
      return;
    }
    throw error;
  }
}
