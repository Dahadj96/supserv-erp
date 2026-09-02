import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { document, documentLine, documentLink } from "@/db/schema/document";
import { computeTotals } from "@/domain/money";
import { mayConvert } from "./conversion";
import { dutyOnDraft } from "./draft";

/**
 * Screen 48 — the write half.
 *
 * "The proforma is never replaced. It stays on file, linked to the facture, and
 * its number is not reused."
 *
 * Nothing in here updates the source document. It is read, copied and linked.
 * The one row written against it is the `converted_to` link, which is a fact
 * about the pair rather than a change to either.
 */

export class CannotConvert extends Error {
  constructor(
    readonly why:
      | "noSuchDocument"
      | "notIssued"
      | "conversionNotAllowed"
      | "alreadyConverted"
      | "nothingToCopy",
  ) {
    super(why);
  }
}

export type ConvertOptions = {
  documentId: string;
  target: string;
  /** The date that will go on the new document. */
  invoiceDate: string;
  dueDate: string | null;
  paymentMethod: string | null;
  actorId: string;
};

/**
 * Create the new document as a DRAFT with no number.
 *
 * The number is reserved by `reserveNumber` inside the transaction that ISSUES
 * a document, and handing one out here would break the register: two people
 * converting on the same afternoon would be given the same next number, and an
 * abandoned draft would leave a hole in a sequence that must be gapless.
 * Screen 48's Number row shows what it will look like and says it is not
 * reserved — see the note at the top of `conversion.ts`.
 */
export async function convertDocument(opts: ConvertOptions): Promise<string> {
  const [source] = await db
    .select()
    .from(document)
    .where(eq(document.id, opts.documentId))
    .limit(1);
  if (!source) throw new CannotConvert("noSuchDocument");

  // Converting a draft is not converting anything — the client has never seen
  // it, so there is nothing to preserve and the honest action is to edit it.
  if (!source.number) throw new CannotConvert("notIssued");
  if (!mayConvert(source.kind, opts.target)) throw new CannotConvert("conversionNotAllowed");

  const existing = await db
    .select({ to: documentLink.toDocument })
    .from(documentLink)
    .where(eq(documentLink.fromDocument, opts.documentId));
  // One proforma, one facture. A second conversion is somebody clicking twice
  // or somebody about to invoice a client for the same thing again.
  if (existing.some((row) => row.to)) throw new CannotConvert("alreadyConverted");

  const lines = await db
    .select()
    .from(documentLine)
    .where(eq(documentLine.documentId, opts.documentId))
    .orderBy(asc(documentLine.position));

  const kept = lines.filter((line) => !line.isOption);
  if (kept.filter((line) => line.lineKind === "item").length === 0) {
    throw new CannotConvert("nothingToCopy");
  }

  const priceable = kept
    .filter((line) => line.lineKind === "item")
    .map((line) => ({
      qty: line.qty ?? "0",
      unitPrice: line.unitPrice ?? "0",
      discountPct: line.discountPct ?? "0",
      vatRate: line.vatRate ?? "0",
    }));
  const adjustments = {
    globalDiscountPct: source.globalDiscountPct ?? "0",
    advanceDeducted: source.advanceDeducted ?? "0",
  };

  // The facture inherits how the proforma said it would be settled, and the
  // droit de timbre follows from that the same way it does in the builder —
  // once the rule is confirmed, on the sum including VAT. This used to write
  // "0" with a note that the duty would be added at issue, and nothing did.
  const before = computeTotals(priceable, adjustments);
  const stampDuty = await dutyOnDraft(before.totalIncl, source.settlement);
  const totals = computeTotals(priceable, { ...adjustments, stampDuty });

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(document)
      .values({
        kind: opts.target,
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
        advanceDeducted: source.advanceDeducted,
        retentionPct: source.retentionPct,
        settlement: source.settlement,
        stampDuty,
        totals,
      })
      .returning({ id: document.id });

    const id = created?.id as string;

    if (kept.length > 0) {
      await tx.insert(documentLine).values(
        kept.map((line, index) => ({
          documentId: id,
          // Renumbered, because dropping the options would otherwise leave
          // gaps in the positions and the first edit would reorder the page.
          position: index + 1,
          lineKind: line.lineKind,
          isOption: false,
          itemId: line.itemId,
          reference: line.reference,
          designation: line.designation,
          note: line.note,
          designationSource: line.designationSource,
          unit: line.unit,
          qty: line.qty,
          unitPrice: line.unitPrice,
          // The cost trail comes across intact. Screen 12's margin has to keep
          // working on the facture, and re-deriving the cost six weeks later
          // from a supplier quote that has since been superseded would change
          // a margin nobody touched.
          unitCost: line.unitCost,
          costSource: line.costSource,
          costQuoteId: line.costQuoteId,
          discountPct: line.discountPct,
          vatRate: line.vatRate,
          vatExemptRef: line.vatExemptRef,
          totalExcl: line.totalExcl,
        })),
      );
    }

    await tx
      .insert(documentLink)
      .values({ fromDocument: opts.documentId, toDocument: id, relation: "converted_to" });

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "document",
      entityId: id,
      action: "create",
      after: {
        convertedFrom: opts.documentId,
        sourceNumber: source.number,
        sourceKind: source.kind,
        kind: opts.target,
        // Named so the log answers "was a number handed out here?" without
        // anybody having to know that it was not.
        number: null,
        numberReserved: false,
        linesCopied: kept.length,
        optionsDropped: lines.length - kept.length,
        paymentMethod: opts.paymentMethod,
      },
      sourceScreen: "48",
    });

    return id;
  });
}

/** What a document was made from, and what was made from it. */
export async function chainFor(documentId: string): Promise<{
  from: { id: string; kind: string; number: string | null } | null;
  to: { id: string; kind: string; number: string | null } | null;
}> {
  const [parent] = await db
    .select({ id: document.id, kind: document.kind, number: document.number })
    .from(documentLink)
    .innerJoin(document, eq(document.id, documentLink.fromDocument))
    .where(eq(documentLink.toDocument, documentId))
    .limit(1);

  const [child] = await db
    .select({ id: document.id, kind: document.kind, number: document.number })
    .from(documentLink)
    .innerJoin(document, eq(document.id, documentLink.toDocument))
    .where(eq(documentLink.fromDocument, documentId))
    .limit(1);

  return { from: parent ?? null, to: child ?? null };
}
