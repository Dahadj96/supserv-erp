import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { document, documentLine, documentLink } from "@/db/schema/document";
import { progress } from "@/domain/delivery/lines";
import { coveredAgainst, sourceLines } from "@/domain/delivery/store";
import { computeTotals } from "@/domain/money";
import { dutyOnDraft } from "./draft";

/**
 * Screen 72 — New invoice, from something that already exists.
 *
 * "Most of this is already known · check it rather than type it."
 *
 * The screen's own hardest question is the last row of its carried-over table:
 * "Which lines to invoice — 4 delivered, or all 9 — decide". Its banner puts
 * the case: "4 of 9 order lines are delivered and signed. You can invoice those
 * now, or wait for the rest. Invoicing what is delivered is the faster route to
 * cash."
 *
 * So ONE ORDER BECOMES SEVERAL FACTURES, and this file is the arithmetic that
 * lets it: every invoice line points at the source line it bills, and "already
 * invoiced" is the sum over issued invoices — the same subtraction the delivery
 * notes use, with the same reason for not storing it.
 *
 * That is why this is not `convertDocument`. Screen 48's conversion is one
 * proforma into one facture, whole, and it refuses a second. Billing is
 * partial by nature and refuses only when there is nothing left to bill.
 */

export class CannotBill extends Error {
  constructor(
    readonly why:
      | "noSuchDocument"
      | "sourceNotIssued"
      | "nothingLeftToBill"
      | "nothingDelivered"
      | "nothingChosen",
  ) {
    super(why);
  }
}

/**
 * `delivered` — bill what has actually gone out and been proved.
 * `remaining` — bill everything not yet billed, delivered or not.
 */
export type BillScope = "delivered" | "remaining";

export type BillableLine = {
  lineId: string;
  position: number;
  designation: string | null;
  unit: string | null;
  unitPrice: string | null;
  ordered: string;
  delivered: string;
  alreadyInvoiced: string;
  /** What this invoice would take, under the chosen scope. */
  billable: string;
};

/**
 * What could go on an invoice raised now.
 *
 * `billable` under `delivered` is DELIVERED LESS ALREADY INVOICED, not the
 * lesser of the two taken separately: a line delivered 12 and invoiced 12 has
 * nothing left even though both figures are positive, and a line delivered 24
 * and invoiced 12 has exactly 12 left. Taking min(delivered, ordered −
 * invoiced) gets the common case right and the second delivery wrong.
 */
export async function billable(opts: {
  sourceId: string;
  scope: BillScope;
}): Promise<BillableLine[]> {
  const lines = await sourceLines(opts.sourceId);
  if (lines.length === 0) return [];

  const ids = lines.map((line) => line.lineId);
  const delivered = await coveredAgainst(ids, ["delivery_note"]);
  const invoiced = await coveredAgainst(ids, ["invoice", "advance_invoice", "situation"]);

  const deliveredBy = progress({ sources: lines, delivered });
  const invoicedBy = progress({ sources: lines, delivered: invoiced });

  const priced = await db
    .select({ id: documentLine.id, unitPrice: documentLine.unitPrice })
    .from(documentLine)
    .where(eq(documentLine.documentId, opts.sourceId))
    .orderBy(asc(documentLine.position));

  return lines.map((line, index) => {
    const gone = deliveredBy.lines[index]?.alreadyDelivered ?? "0";
    const billed = invoicedBy.lines[index]?.alreadyDelivered ?? "0";

    const ceiling = opts.scope === "delivered" ? Number(gone) : Number(line.qty);
    const left = Math.max(0, ceiling - Number(billed));

    return {
      lineId: line.lineId,
      position: line.position,
      designation: line.designation,
      unit: line.unit,
      unitPrice: priced.find((p) => p.id === line.lineId)?.unitPrice ?? null,
      ordered: line.qty,
      delivered: gone,
      alreadyInvoiced: billed,
      billable: String(left),
    };
  });
}

/**
 * Raise the draft facture.
 *
 * A draft with no number, as everywhere else — the number is reserved inside
 * the transaction that issues it.
 */
export async function billFrom(opts: {
  sourceId: string;
  /** sourceLineId → quantity to bill. Only positive entries are used. */
  quantities: Record<string, string>;
  invoiceDate: string;
  dueDate: string | null;
  actorId: string;
}): Promise<string> {
  const [source] = await db.select().from(document).where(eq(document.id, opts.sourceId)).limit(1);
  if (!source) throw new CannotBill("noSuchDocument");
  if (!source.number) throw new CannotBill("sourceNotIssued");

  const wanted = Object.entries(opts.quantities).filter(([, qty]) => Number(qty) > 0);
  if (wanted.length === 0) throw new CannotBill("nothingChosen");

  const lines = await db
    .select()
    .from(documentLine)
    .where(eq(documentLine.documentId, opts.sourceId));

  const chosen = wanted
    .map(([lineId, qty]) => ({ line: lines.find((l) => l.id === lineId), qty }))
    .filter((row): row is { line: (typeof lines)[number]; qty: string } => Boolean(row.line));
  if (chosen.length === 0) throw new CannotBill("nothingLeftToBill");

  const priceable = chosen.map(({ line, qty }) => ({
    qty,
    unitPrice: line.unitPrice ?? "0",
    discountPct: line.discountPct ?? "0",
    vatRate: line.vatRate ?? "0",
  }));
  const adjustments = { globalDiscountPct: source.globalDiscountPct ?? "0" };

  // The invoice inherits how the order said it would be settled, and the droit
  // de timbre follows — once the rule is confirmed, on the sum including VAT.
  const before = computeTotals(priceable, adjustments);
  const stampDuty = await dutyOnDraft(before.totalIncl, source.settlement);
  const totals = computeTotals(priceable, { ...adjustments, stampDuty });

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(document)
      .values({
        kind: "invoice",
        number: null,
        partyId: source.partyId,
        dealId: source.dealId,
        locale: source.locale,
        currency: source.currency,
        fxRate: source.fxRate,
        issuedOn: opts.invoiceDate,
        dueOn: opts.dueDate,
        status: "draft",
        globalDiscountPct: source.globalDiscountPct,
        retentionPct: source.retentionPct,
        settlement: source.settlement,
        stampDuty,
        totals,
      })
      .returning({ id: document.id });

    const id = created?.id as string;

    await tx.insert(documentLine).values(
      chosen.map(({ line, qty }, index) => ({
        documentId: id,
        position: index + 1,
        lineKind: "item",
        // The link that makes "already invoiced" answerable on the next one.
        sourceLineId: line.id,
        itemId: line.itemId,
        reference: line.reference,
        designation: line.designation,
        designationSource: line.designationSource,
        unit: line.unit,
        qty,
        unitPrice: line.unitPrice,
        unitCost: line.unitCost,
        costSource: line.costSource,
        costQuoteId: line.costQuoteId,
        discountPct: line.discountPct,
        vatRate: line.vatRate,
        vatExemptRef: line.vatExemptRef,
      })),
    );

    // `covers`, not `converted_to`. The source is not replaced and may be
    // billed again for the rest.
    await tx
      .insert(documentLink)
      .values({ fromDocument: id, toDocument: opts.sourceId, relation: "covers" });

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "document",
      entityId: id,
      action: "create",
      after: {
        kind: "invoice",
        billedFrom: opts.sourceId,
        sourceNumber: source.number,
        lines: chosen.length,
        number: null,
        numberReserved: false,
      },
      sourceScreen: "72",
    });

    return id;
  });
}
