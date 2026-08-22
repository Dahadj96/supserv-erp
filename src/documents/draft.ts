import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { document, documentLine } from "@/db/schema/document";
import { computeTotals, lineTotalExcl } from "@/domain/money";

/**
 * Screen 47 — the document builder, on the writing side.
 *
 * One function edits a draft, and it refuses to touch anything else. LAW 5 is
 * usually stated as "an issued document is immutable"; this is the file where
 * that has to be true, because it is the only one that rewrites lines.
 *
 * The totals are never sent from the browser. The form posts lines; this
 * recomputes with `domain/money.ts` and stores the result. A total that arrived
 * over the wire is a total somebody could have edited.
 */

export const LINE_KINDS = ["item", "section", "text", "subtotal", "page_break"] as const;
export type LineKind = (typeof LINE_KINDS)[number];

export type DraftLine = {
  lineKind: LineKind;
  designation: string;
  reference?: string | null;
  note?: string | null;
  unit?: string | null;
  qty?: string | null;
  unitPrice?: string | null;
  discountPct?: string | null;
  vatRate?: string | null;
  isOption?: boolean;
};

export type DraftPatch = {
  kind?: string;
  issuedOn?: string | null;
  globalDiscountPct?: string;
  advanceDeducted?: string;
  retentionPct?: string;
  validDays?: number | null;
  lines: DraftLine[];
};

export class DraftRefused extends Error {
  constructor(readonly reason: "noSuchDocument" | "alreadyIssued" | "noLines") {
    super(reason);
  }
}

/** Only an item line carries money. A section or a note priced at zero is noise. */
function priced(line: DraftLine): boolean {
  return line.lineKind === "item";
}

/**
 * Lines that survive a save. A row with no designation was never typed into;
 * dropping it silently is kinder than storing a blank line the client will see.
 */
export function keepable(lines: DraftLine[]): DraftLine[] {
  return lines.filter((line) => {
    if (line.lineKind === "page_break") return true;
    if (!line.designation.trim()) return false;
    if (priced(line) && !(Number(line.qty ?? 0) > 0)) return false;
    return true;
  });
}

export async function saveDraft(
  documentId: string,
  patch: DraftPatch,
  actorId: string,
): Promise<void> {
  const [record] = await db.select().from(document).where(eq(document.id, documentId)).limit(1);
  if (!record) throw new DraftRefused("noSuchDocument");

  // LAW 5. Not "the UI hides the button" — the function refuses.
  if (record.number || record.lockedAt || record.status !== "draft") {
    throw new DraftRefused("alreadyIssued");
  }

  const lines = keepable(patch.lines);
  if (lines.length === 0) throw new DraftRefused("noLines");

  const totals = computeTotals(
    lines.filter(priced).map((line) => ({
      qty: line.qty ?? 0,
      unitPrice: line.unitPrice ?? 0,
      discountPct: line.discountPct ?? 0,
      vatRate: line.vatRate ?? 0,
      isOption: line.isOption ?? false,
    })),
    {
      globalDiscountPct: patch.globalDiscountPct ?? "0",
      advanceDeducted: patch.advanceDeducted ?? "0",
      // Stamp duty is not chosen here. It follows the settlement method and a
      // rule nobody has confirmed — see the compliance profile.
    },
  );

  await db.transaction(async (tx) => {
    await tx
      .update(document)
      .set({
        kind: patch.kind ?? record.kind,
        issuedOn: patch.issuedOn ?? record.issuedOn,
        globalDiscountPct: patch.globalDiscountPct ?? "0",
        advanceDeducted: patch.advanceDeducted ?? "0",
        retentionPct: patch.retentionPct ?? "0",
        validDays: patch.validDays ?? record.validDays,
        totals,
      })
      .where(eq(document.id, documentId));

    // Replaced wholesale rather than diffed. A draft's lines have no identity
    // anybody refers to yet — no delivery note points at line 4 — so rewriting
    // them is simpler and cannot leave an orphan.
    await tx.delete(documentLine).where(eq(documentLine.documentId, documentId));

    await tx.insert(documentLine).values(
      lines.map((line, index) => ({
        documentId,
        position: index + 1,
        lineKind: line.lineKind,
        isOption: line.isOption ?? false,
        designation: line.designation.trim() || null,
        reference: line.reference?.trim() || null,
        note: line.note?.trim() || null,
        unit: priced(line) ? line.unit?.trim() || null : null,
        qty: priced(line) ? (line.qty ?? "0") : null,
        unitPrice: priced(line) ? (line.unitPrice ?? "0") : null,
        discountPct: priced(line) ? (line.discountPct ?? "0") : null,
        vatRate: priced(line) ? (line.vatRate ?? "0") : null,
        totalExcl: priced(line)
          ? lineTotalExcl({
              qty: line.qty ?? 0,
              unitPrice: line.unitPrice ?? 0,
              discountPct: line.discountPct ?? 0,
              isOption: line.isOption ?? false,
            }).toFixed(2)
          : null,
      })),
    );

    await tx.insert(auditEntry).values({
      actorId,
      actorKind: "user",
      entity: "document",
      entityId: documentId,
      action: "edit",
      before: { totals: record.totals, kind: record.kind },
      after: { totals, kind: patch.kind ?? record.kind, lines: lines.length },
      sourceScreen: "47",
    });
  });
}
