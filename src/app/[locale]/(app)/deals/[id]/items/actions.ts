"use server";

import { revalidatePath } from "next/cache";
import { can, canWrite } from "@/auth/can";
import { getSession } from "@/auth/session";
import { editLines, type LineEdit, LinesRefused } from "@/domain/deal/lines";
import { parsePaste } from "@/domain/deal/paste";
import { readLinesFrom, SourceRefused } from "@/domain/deal/sources";
import { redirect } from "@/i18n/navigation";
import type { Proposal, ProposedRow } from "./proposal";

/**
 * Screen 73 — the item list of an enquiry that already exists.
 *
 * Three actions, and the split between them is a permission split, not a
 * tidiness one:
 *
 *   saveLinesAction   writes `deal_line`. `canWrite` — everybody but `lecture`.
 *   readPasteAction   reads text the caller typed into the box in front of
 *                     them. Also `canWrite`: they are reading their own paste.
 *   readSourceAction  reads the client's EMAIL and the files attached to it.
 *                     That is correspondence, so it asks `inbox.view` as well —
 *                     the same gate the inbox itself holds, for the same
 *                     reason: raw mail is not a curated record.
 */

const rowsOf = (
  parsed: { reference: string | null; designation: string; qty: string; unit: string | null }[],
): ProposedRow[] =>
  parsed.map((line) => ({
    reference: line.reference ?? "",
    designation: line.designation,
    qty: line.qty,
    unit: line.unit ?? "",
  }));

/**
 * Save the table as it stands.
 *
 * The rows arrive as parallel arrays in document order — the same shape screen
 * 47's builder posts, and for the same reason: the browser sends repeated field
 * names in the order they appear, so the order on screen is the order saved
 * without an index to keep in step.
 *
 * `lineId` is what makes this an edit rather than a replacement. A row that
 * still carries the id it was loaded with is UPDATED, so the shop-counter price
 * captured against it and the catalogue item somebody matched it to survive a
 * corrected quantity. `editLines` treats an id it does not recognise as a new
 * row, so nothing arriving from a browser can reach another deal's line.
 */
export async function saveLinesAction(locale: string, dealId: string, form: FormData) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }
  if (!canWrite(session.role)) {
    redirect({ href: `/deals/${dealId}/items?error=notAllowed`, locale });
    return;
  }

  const ids = form.getAll("lineId").map(String);
  const references = form.getAll("reference").map(String);
  const designations = form.getAll("designation").map(String);
  const quantities = form.getAll("qty").map(String);
  const units = form.getAll("unit").map(String);

  const rows: LineEdit[] = designations.map((designation, i) => ({
    id: (ids[i] ?? "").trim() || null,
    reference: references[i] ?? null,
    designation,
    qty: quantities[i] ?? "",
    unit: units[i] ?? null,
  }));

  try {
    const report = await editLines({ dealId, rows, actorId: session.userId });
    revalidatePath(`/${locale}/deals/${dealId}/items`);
    revalidatePath(`/${locale}/deals/${dealId}`);
    redirect({
      href: `/deals/${dealId}/items?saved=${report.kept + report.added}&removed=${report.removed}`,
      locale,
    });
  } catch (error) {
    if (error instanceof LinesRefused) {
      redirect({ href: `/deals/${dealId}/items?error=${error.reason}`, locale });
      return;
    }
    throw error;
  }
}

/**
 * Read the client's email, or one of the files they attached, into proposed
 * rows.
 *
 * Returns them; writes nothing. The rows appear in the table where they can be
 * corrected and deleted, and the person saves when the table matches what the
 * client asked for — LAW 2, the same shape as screen 40.
 */
export async function readSourceAction(dealId: string, key: string): Promise<Proposal> {
  const session = await getSession();
  if (!session) return { ok: false, reason: "notAllowed" };
  if (!canWrite(session.role) || !can(session.role, "inbox.view")) {
    return { ok: false, reason: "notAllowed" };
  }

  try {
    const read = await readLinesFrom(dealId, key);
    return { ok: true, label: read.label, rows: rowsOf(read.lines), ignored: read.ignored.length };
  } catch (error) {
    if (error instanceof SourceRefused) {
      return { ok: false, reason: error.reason, detail: error.detail };
    }
    throw error;
  }
}

/**
 * Read text somebody pasted into the box.
 *
 * The text is read HERE and not in the browser, which is the rule screen 06 and
 * screen 61 already hold: a second implementation of `parsePaste` running where
 * it cannot be tested would disagree with this one on the line that mattered.
 * What the browser then shows is a table of fields, and those fields are what
 * the person approves and what gets saved — so the paste is read once, by the
 * server, and never read again.
 */
export async function readPasteAction(_dealId: string, text: string): Promise<Proposal> {
  const session = await getSession();
  if (!session) return { ok: false, reason: "notAllowed" };
  if (!canWrite(session.role)) return { ok: false, reason: "notAllowed" };

  const read = parsePaste(text);
  if (read.lines.length === 0) return { ok: false, reason: "nothingRead" };

  return { ok: true, label: "", rows: rowsOf(read.lines), ignored: read.ignored.length };
}
