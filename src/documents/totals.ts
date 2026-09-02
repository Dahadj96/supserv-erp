import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { document, documentLine } from "@/db/schema/document";
import { computeTotals, lineTotalExcl } from "@/domain/money";
import { dutyOnDraft } from "./draft";

/**
 * LAW 1 for the totals of a DRAFT — compute, don't store — with the one
 * concession the engine needs: the figures are written onto the row so that
 * issue can freeze them (LAW 5) and every list can read them without summing
 * lines.
 *
 * The builder (screen 47) computes them itself inside `saveDraft`, because it
 * has the lines in hand. Every OTHER place that changes a price on a draft —
 * screen 12 pricing an offer line by line, a BPU carrying last year's prices
 * onto a tender's offer — calls this, so a document never reaches issue with
 * prices on its lines and `{}` in its totals. That is not a hypothetical: the
 * first end-to-end walk of enquiry → offer → PDF printed "Total HT 0,00"
 * under a fully priced table.
 */
export async function recomputeTotals(documentId: string): Promise<void> {
  const [record] = await db.select().from(document).where(eq(document.id, documentId)).limit(1);
  if (!record) return;
  // An issued document's totals are frozen. Whoever asked has a bug, and the
  // bug must not become a changed invoice.
  if (record.lockedAt || record.status !== "draft") return;

  const lines = await db
    .select()
    .from(documentLine)
    .where(eq(documentLine.documentId, documentId))
    .orderBy(asc(documentLine.position));

  const items = lines.filter((line) => line.lineKind === "item");
  const priceable = items.map((line) => ({
    qty: line.qty ?? "0",
    unitPrice: line.unitPrice ?? "0",
    discountPct: line.discountPct ?? "0",
    vatRate: line.vatRate ?? "0",
    isOption: line.isOption ?? false,
  }));
  const adjustments = {
    globalDiscountPct: record.globalDiscountPct ?? "0",
    advanceDeducted: record.advanceDeducted ?? "0",
  };

  // Two passes, as in `saveDraft`: the droit de timbre sits on the sum
  // including VAT, which the first pass computes.
  const before = computeTotals(priceable, adjustments);
  const stampDuty = await dutyOnDraft(before.totalIncl, record.settlement);
  const totals = computeTotals(priceable, { ...adjustments, stampDuty });

  await db.transaction(async (tx) => {
    for (const line of items) {
      await tx
        .update(documentLine)
        .set({
          totalExcl: lineTotalExcl({
            qty: line.qty ?? "0",
            unitPrice: line.unitPrice ?? "0",
            discountPct: line.discountPct ?? "0",
            isOption: line.isOption ?? false,
          }).toFixed(2),
        })
        .where(eq(documentLine.id, line.id));
    }
    await tx.update(document).set({ stampDuty, totals }).where(eq(document.id, documentId));
  });
}
