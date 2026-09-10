import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine } from "@/db/schema/deal";
import { type ParsedLine, readQty } from "./paste";

/**
 * Screen 06's line table — the only file that writes `deal_line`.
 *
 * Same shape as `src/documents/draft.ts`: one door in, so there is one place
 * that knows the rules. The rule here is short — positions are the client's
 * order and stay contiguous — but it is the sort of rule that quietly stops
 * being true when three screens each insert rows their own way.
 */

export class LinesRefused extends Error {
  constructor(readonly reason: "noSuchDeal" | "closed" | "nothingToAdd" | "badQty") {
    super(reason);
  }
}

/** The deal must exist and must still be editable. Both writers ask this. */
async function editableDeal(dealId: string): Promise<void> {
  const [row] = await db
    .select({ lostAt: deal.lostAt })
    .from(deal)
    .where(and(eq(deal.id, dealId), sql`${deal.deletedAt} is null`))
    .limit(1);
  if (!row) throw new LinesRefused("noSuchDeal");
  // A no-bid enquiry can still have its lines corrected — somebody may be
  // recording what was asked for so the next one is faster. A LOST one cannot:
  // the offer went out, the client chose somebody else, and editing what they
  // asked for now rewrites history.
  if (row.lostAt) throw new LinesRefused("closed");
}

/**
 * Replace the lines of an enquiry with what a person confirmed on screen.
 *
 * REPLACE, not merge. The person is looking at a table they have just checked
 * against the client's email; merging would leave rows from a previous paste
 * that are not on the screen they approved, and the first anyone would know is
 * an offer with fifteen lines where the client asked for fourteen.
 */
export async function replaceLines(opts: {
  dealId: string;
  lines: ParsedLine[];
  actorId: string;
}): Promise<number> {
  if (opts.lines.length === 0) throw new LinesRefused("nothingToAdd");

  await editableDeal(opts.dealId);

  return db.transaction(async (tx) => {
    const before = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(dealLine)
      .where(eq(dealLine.dealId, opts.dealId));

    await tx.delete(dealLine).where(eq(dealLine.dealId, opts.dealId));

    await tx.insert(dealLine).values(
      opts.lines.map((line, index) => ({
        dealId: opts.dealId,
        // Renumbered from one, contiguous, in the order shown. The client's own
        // numbering is not reused: they skip numbers, and a unique index on
        // (deal_id, position) would refuse the paste for a reason nobody could
        // act on.
        position: index + 1,
        reference: line.reference,
        designation: line.designation,
        qty: line.qty,
        unit: line.unit,
        matchedBy: null,
      })),
    );

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "deal",
      entityId: opts.dealId,
      action: "update",
      before: { lineCount: before[0]?.n ?? 0 },
      after: {
        lineCount: opts.lines.length,
        // How each line was read, so a wrong quantity can be traced back to the
        // shape of the paste rather than guessed at.
        readAs: opts.lines.map((l) => l.readAs),
        assumedQty: opts.lines.filter((l) => l.qtyAssumed).length,
      },
      sourceScreen: "06",
    });

    return opts.lines.length;
  });
}

/**
 * One row of the item table as a person left it on screen 73.
 *
 * `id` is the row it already was. That single field is the difference between
 * this and `replaceLines`, and it is the whole point of the function: a line
 * whose quantity was corrected from 12 to 20 stays the SAME `deal_line`, so the
 * shop-counter price captured against it on Tuesday, and the catalogue item
 * somebody matched it to on Wednesday, are still attached on Thursday.
 *
 * `replaceLines` deletes every row and writes new ones, which is right for a
 * paste — a paste is a new list — and wrong for an edit, where four of the five
 * lines are the same line they were a minute ago.
 */
export type LineEdit = {
  /** The `deal_line` this row already is, or null for a row somebody added. */
  id: string | null;
  reference: string | null;
  designation: string;
  qty: string;
  unit: string | null;
};

export type EditReport = { kept: number; added: number; removed: number };

/**
 * Save the item table as it stands on screen 73.
 *
 * Rows arrive in the order shown and are numbered from one in that order, so
 * moving a line up moves it up. Rows with no designation are dropped rather
 * than refused: an empty row is what pressing "add a line" and then changing
 * your mind leaves behind, and refusing the save over it would mean hunting for
 * a blank row in a table of twenty.
 *
 * AN EMPTY LIST IS ALLOWED. `replaceLines` refuses one because a paste that
 * reads as nothing is a parse that failed; here the person has deleted every
 * row one at a time, watching them go, and "there is no way to delete it" was a
 * real complaint about a real hole.
 */
export async function editLines(opts: {
  dealId: string;
  rows: LineEdit[];
  actorId: string;
}): Promise<EditReport> {
  await editableDeal(opts.dealId);

  const rows = opts.rows
    .map((row) => ({
      id: row.id,
      reference: row.reference?.trim() || null,
      designation: row.designation.trim(),
      qty: row.qty.trim(),
      unit: row.unit?.trim() || null,
    }))
    .filter((row) => row.designation.length > 0)
    .map((row) => {
      // Read with the SAME reader the paste uses, so `2,5` typed into the grid
      // and `2,5` pasted out of Excel become the same number. A quantity that
      // will not read is refused rather than defaulted to 1: on a paste, 1 is a
      // stated assumption a person can see in the table; typed by hand into a
      // box labelled Qty, it would be a silent correction of what they meant.
      const qty = readQty(row.qty);
      if (qty === null || Number(qty) <= 0) throw new LinesRefused("badQty");
      return { ...row, qty };
    });

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: dealLine.id })
      .from(dealLine)
      .where(eq(dealLine.dealId, opts.dealId));

    const alive = new Set(existing.map((row) => row.id));
    // A row claiming an id that is not on this deal is treated as a new row.
    // The alternative is trusting an id that arrived from a browser, and
    // `deal_line.id` is not a secret.
    const kept = rows.filter((row) => row.id !== null && alive.has(row.id));
    const gone = existing.filter((row) => !kept.some((k) => k.id === row.id)).map((row) => row.id);

    if (gone.length > 0) await tx.delete(dealLine).where(inArray(dealLine.id, gone));

    /*
      `deal_line_position` is a unique index on (deal_id, position) and Postgres
      checks it row by row, not at the end of the statement. Renumbering in
      place therefore collides the moment two lines swap: setting line 2 to 1
      is refused while line 1 is still 1.

      So every surviving row is parked on its own negative first. Positions are
      always >= 1, so the negatives cannot collide with each other or with
      anything about to be written.
    */
    if (existing.length > 0) {
      await tx
        .update(dealLine)
        .set({ position: sql`0 - ${dealLine.position}` })
        .where(eq(dealLine.dealId, opts.dealId));
    }

    const added: typeof rows = [];

    for (const [index, row] of rows.entries()) {
      const position = index + 1;
      if (row.id !== null && alive.has(row.id)) {
        await tx
          .update(dealLine)
          .set({
            position,
            reference: row.reference,
            designation: row.designation,
            qty: row.qty,
            unit: row.unit,
          })
          .where(eq(dealLine.id, row.id));
      } else {
        added.push(row);
        await tx.insert(dealLine).values({
          dealId: opts.dealId,
          position,
          reference: row.reference,
          designation: row.designation,
          qty: row.qty,
          unit: row.unit,
          matchedBy: null,
        });
      }
    }

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "deal",
      entityId: opts.dealId,
      action: "update",
      before: { lineCount: existing.length },
      after: {
        lineCount: rows.length,
        kept: kept.length,
        added: added.length,
        removed: gone.length,
      },
      sourceScreen: "73",
    });

    return { kept: kept.length, added: added.length, removed: gone.length };
  });
}
