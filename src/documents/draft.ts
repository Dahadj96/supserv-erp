import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { document, documentLine } from "@/db/schema/document";
import { blockingRule } from "@/db/schema/interface";
import { situationDetail } from "@/db/schema/project";
import { issuingRules } from "@/domain/document-types";
import { computeTotals, lineTotalExcl } from "@/domain/money";
import { isInstrument, STAMP_DUTY_RULE } from "@/domain/money/instruments";
import { stampDutyFor } from "@/domain/money/stamp-duty";

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
  /** virement | cheque | especes | traite | compensation. Null: not said yet. */
  settlement?: string | null;
  /**
   * The counterparty's own reference, for a kind screen 50 numbers by
   * `clientReference` — a client's bon de commande. Ignored on every kind we
   * number ourselves: LAW 5 says those numbers are allocated at issue, never
   * typed.
   */
  theirNumber?: string | null;
  lines: DraftLine[];
};

export class DraftRefused extends Error {
  constructor(
    readonly reason:
      | "noSuchDocument"
      | "alreadyIssued"
      | "noLines"
      | "situationHasItsOwnScreen"
      | "amendmentHasItsOwnScreen",
  ) {
    super(reason);
  }
}

/**
 * The droit de timbre a draft should carry, given how it will be settled.
 *
 * The one place the rule's confirmation is read on the writing side. Three
 * callers — `saveDraft`, `convertDocument`, `billDocument` — so that a facture
 * made from a cash proforma carries the same figure the builder would show.
 */
export async function dutyOnDraft(
  totalIncl: string,
  settlement: string | null | undefined,
): Promise<string> {
  const [rule] = await db
    .select({ confirmedOn: blockingRule.confirmedOn })
    .from(blockingRule)
    .where(eq(blockingRule.code, STAMP_DUTY_RULE))
    .limit(1);

  return stampDutyFor({ totalIncl, settlement, ruleConfirmed: Boolean(rule?.confirmedOn) });
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

  // LAW 5. Not "the UI hides the button" — the function refuses. The STATE is
  // what says a document is issued; a client's order carries their number
  // from the day it arrives and is still a draft until somebody records it.
  if (record.lockedAt || record.status !== "draft") {
    throw new DraftRefused("alreadyIssued");
  }

  // A situation's lines each point at a line of the marché, and the builder
  // rewrites lines wholesale without that link. Its quantities are edited on
  // the project's own screen, which keeps the arithmetic honest.
  if (record.kind === "situation") {
    const [detail] = await db
      .select({ projectId: situationDetail.projectId })
      .from(situationDetail)
      .where(eq(situationDetail.documentId, documentId))
      .limit(1);
    if (detail) throw new DraftRefused("situationHasItsOwnScreen");
  }

  // An avenant for the same reason, and it matters more: its lines say which
  // line of the marché each one REPLACES. Saved through the builder they
  // would all come back pointing at nothing, and the avenant would read as
  // forty new prices added to a bordereau it was meant to correct.
  if (record.kind === "amendment") throw new DraftRefused("amendmentHasItsOwnScreen");

  const lines = keepable(patch.lines);
  if (lines.length === 0) throw new DraftRefused("noLines");

  const kind = patch.kind ?? record.kind;
  const rules = await issuingRules(kind);
  const carriesTheirNumber = !(rules?.reservesNumber ?? true);
  // Only a kind numbered by the counterparty takes a typed number. On any
  // other kind the field is ignored, and a number already on the row (which
  // can only be there if the kind was changed from one that carries theirs)
  // is cleared rather than presented as one of ours.
  const number = carriesTheirNumber
    ? patch.theirNumber === undefined
      ? record.number
      : patch.theirNumber?.trim() || null
    : null;

  const settlement =
    patch.settlement === undefined
      ? record.settlement
      : patch.settlement && isInstrument(patch.settlement)
        ? patch.settlement
        : null;

  const priceable = lines.filter(priced).map((line) => ({
    qty: line.qty ?? 0,
    unitPrice: line.unitPrice ?? 0,
    discountPct: line.discountPct ?? 0,
    vatRate: line.vatRate ?? 0,
    isOption: line.isOption ?? false,
  }));

  const adjustments = {
    globalDiscountPct: patch.globalDiscountPct ?? "0",
    advanceDeducted: patch.advanceDeducted ?? "0",
  };

  /**
   * The droit de timbre is not chosen by a person and not asserted by the
   * software. It follows the settlement method — cash attracts it, nothing
   * else does — and it is only put on the document once somebody has confirmed
   * `invoice.stampDutyThreshold` on screen 69 with a name and a date. Until
   * then the figure is nought and the engine warns at issue, which is the
   * behaviour screen 85 promises for every rule waiting on the accountant.
   *
   * Two passes because the duty is on the sum INCLUDING VAT, and the sum
   * including VAT is what the first pass computes.
   */
  const before = computeTotals(priceable, adjustments);
  const stampDuty = await dutyOnDraft(before.totalIncl, settlement);
  const totals = computeTotals(priceable, { ...adjustments, stampDuty });

  await db.transaction(async (tx) => {
    await tx
      .update(document)
      .set({
        kind,
        number,
        issuedOn: patch.issuedOn ?? record.issuedOn,
        globalDiscountPct: patch.globalDiscountPct ?? "0",
        advanceDeducted: patch.advanceDeducted ?? "0",
        retentionPct: patch.retentionPct ?? "0",
        validDays: patch.validDays ?? record.validDays,
        settlement,
        stampDuty,
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
      after: { totals, kind, number, lines: lines.length },
      sourceScreen: "47",
    });
  });
}
