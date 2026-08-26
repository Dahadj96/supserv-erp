import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine } from "@/db/schema/deal";
import type { ParsedLine } from "./paste";

/**
 * Screen 06's line table — the only file that writes `deal_line`.
 *
 * Same shape as `src/documents/draft.ts`: one door in, so there is one place
 * that knows the rules. The rule here is short — positions are the client's
 * order and stay contiguous — but it is the sort of rule that quietly stops
 * being true when three screens each insert rows their own way.
 */

export class LinesRefused extends Error {
  constructor(readonly reason: "noSuchDeal" | "closed" | "nothingToAdd") {
    super(reason);
  }
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

  const [row] = await db
    .select({ lostAt: deal.lostAt, decision: deal.decision })
    .from(deal)
    .where(and(eq(deal.id, opts.dealId), sql`${deal.deletedAt} is null`))
    .limit(1);
  if (!row) throw new LinesRefused("noSuchDeal");
  // A no-bid enquiry can still have its lines corrected — somebody may be
  // recording what was asked for so the next one is faster. A LOST one cannot:
  // the offer went out, the client chose somebody else, and editing what they
  // asked for now rewrites history.
  if (row.lostAt) throw new LinesRefused("closed");

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
