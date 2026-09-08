import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { document, documentLine, documentLink } from "@/db/schema/document";
import { assertTransition, IllegalTransition } from "@/domain/control/transitions";
import { SEED_TYPES } from "@/domain/document-types";
import { type RenderedDocument, render } from "./engine";
import { peekNumber } from "./numbering";

/**
 * LAW 5, the second half — "cancelling writes an avoir".
 *
 * An issued invoice is never edited, never deleted and never un-numbered. When
 * it turns out to be wrong the paper stays exactly as the client received it
 * and a SECOND document says it is cancelled: a facture d'avoir, with its own
 * number in its own series, naming the invoice it credits and why.
 *
 * This file is modelled on `convert.ts` rather than being a second path,
 * because an avoir is the same act: one document is read, copied and linked,
 * and nothing about the source's own row changes except the one word that says
 * what it now IS. `status` moves `issued -> credited`, which
 * `MACHINES.document` has declared as an edge since screen 64 was written and
 * which, until this file existed, nothing in the codebase produced.
 *
 * WHAT IS DELIBERATELY NOT HERE — a partial credit. An avoir for part of an
 * invoice (a returned line, a discount agreed after the fact) leaves the
 * invoice owed for the rest, which is a different arithmetic and a different
 * screen. This is the full credit: the whole invoice, cancelled, its figures
 * restated exactly. The open questions that a partial avoir raises are written
 * down in `docs/FIX-QUEUE.md` under "Needs Abdou" rather than guessed at here.
 */

/**
 * Which kinds may be credited — read off the catalogue, not typed a second
 * time. Screen 50 says `invoice → credit_note` and says it for one kind only;
 * a list here would be a second opinion about what the catalogue already
 * answers, and the day somebody adds `advance_invoice → credit_note` there
 * they would have to remember this file too.
 */
const CREDITABLE = new Set(
  SEED_TYPES.filter((type) => type.convertsTo.includes("credit_note")).map((type) => type.kind),
);

export function mayCredit(kind: string): boolean {
  return CREDITABLE.has(kind);
}

export class CannotCredit extends Error {
  constructor(
    readonly why:
      | "noSuchDocument"
      | "notIssued"
      | "kindCannotBeCredited"
      | "alreadyCredited"
      | "reasonRequired"
      | "nothingToCopy",
  ) {
    super(why);
  }
}

/** The avoir that cancelled this document, if one has been raised. */
export async function creditedBy(documentId: string): Promise<{
  id: string;
  number: string | null;
  issuedOn: string | null;
} | null> {
  const [row] = await db
    .select({ id: document.id, number: document.number, issuedOn: document.issuedOn })
    .from(documentLink)
    .innerJoin(document, eq(document.id, documentLink.fromDocument))
    .where(and(eq(documentLink.toDocument, documentId), eq(documentLink.relation, "credits")))
    .limit(1);
  return row ?? null;
}

/** What this avoir cancels. The other direction of the same one link. */
export async function creditNoteCancels(creditNoteId: string): Promise<{
  id: string;
  kind: string;
  number: string | null;
  issuedOn: string | null;
} | null> {
  const [row] = await db
    .select({
      id: document.id,
      kind: document.kind,
      number: document.number,
      issuedOn: document.issuedOn,
    })
    .from(documentLink)
    .innerJoin(document, eq(document.id, documentLink.toDocument))
    .where(and(eq(documentLink.fromDocument, creditNoteId), eq(documentLink.relation, "credits")))
    .limit(1);
  return row ?? null;
}

/**
 * Everything screen 18 needs to draw the cancel card — including the reasons
 * it must be grey, because a control that vanishes teaches nobody anything.
 */
export type CancelState = {
  kind: string;
  status: string;
  issued: boolean;
  /** Whether this KIND may be credited at all. Screen 50 decides. */
  creditable: boolean;
  /** Whether the avoir series has been set up. No series, no number, no avoir. */
  seriesReady: boolean;
  /** The avoir that cancelled this document. */
  creditNote: { id: string; number: string | null; issuedOn: string | null } | null;
  /** What this document cancels, when it is itself an avoir. */
  cancels: { id: string; kind: string; number: string | null; issuedOn: string | null } | null;
};

export async function cancelState(documentId: string): Promise<CancelState> {
  const [row] = await db
    .select({ kind: document.kind, status: document.status, lockedAt: document.lockedAt })
    .from(document)
    .where(eq(document.id, documentId))
    .limit(1);

  const [creditNote, cancels, series] = await Promise.all([
    creditedBy(documentId),
    creditNoteCancels(documentId),
    // Reserves nothing — it is the series pattern, read to find out whether
    // there IS one. Screen 85 asks for the series a company actually uses, so
    // a company that has not set up an avoir series has to be told that in
    // words rather than meeting `NoSeries` after pressing the button.
    peekNumber("credit_note"),
  ]);

  return {
    kind: row?.kind ?? "",
    status: row?.status ?? "draft",
    issued: row?.status === "issued" || row?.lockedAt != null,
    creditable: mayCredit(row?.kind ?? ""),
    seriesReady: series !== null,
    creditNote,
    cancels,
  };
}

export type CancelResult = {
  creditNoteId: string;
  /** The avoir's own number, from the avoir's own series. */
  number: string | null;
  /** The rendered avoir, so the caller can file the same bytes it was issued as. */
  rendered: RenderedDocument;
};

/**
 * Cancel an issued invoice by raising and issuing an avoir for its full value.
 *
 * THE ORDER IS THE POINT, and it is the opposite of the obvious one:
 *
 *   1. the avoir is written as a draft, linked to the invoice in the same
 *      statement — so a second person pressing Cancel a moment later is
 *      refused by `document_credited_once` before any number is spent;
 *   2. the avoir is ISSUED through the one engine, which is what allocates its
 *      number (LAW 3, and LAW 5's "numbers are allocated at issue");
 *   3. only then does the invoice become `credited`.
 *
 * Marking the invoice first would be tidier to read and wrong to run: an avoir
 * that fails to issue — day one unfinished, a rule confirmed that afternoon —
 * would leave an invoice reading "credited" with no paper behind it, which is
 * the one state a client's accountant cannot be shown. This way round the bad
 * afternoon leaves an issued avoir and an invoice still reading "issued",
 * which is visible, linked, and finishable.
 */
export async function cancelByCreditNote(opts: {
  documentId: string;
  /** Why. Required — an avoir with no reason is not a document anybody can defend. */
  reason: string;
  /** The date on the avoir. Defaults to today. */
  issuedOn?: string;
  actorId: string;
}): Promise<CancelResult> {
  const reason = opts.reason.trim();
  if (!reason) throw new CannotCredit("reasonRequired");

  const [source] = await db
    .select()
    .from(document)
    .where(eq(document.id, opts.documentId))
    .limit(1);
  if (!source) throw new CannotCredit("noSuchDocument");

  if (!mayCredit(source.kind)) throw new CannotCredit("kindCannotBeCredited");

  // The STATE, not the number — the same lesson `render` learned. An invoice
  // always carries one of ours, but asking the state is what keeps this true
  // if a creditable kind is ever added that carries the client's.
  if (source.status !== "issued") {
    // `credited` and `written_off` both land here, and the caller wants to
    // know which: one has an avoir behind it and the other does not.
    throw new CannotCredit(source.status === "draft" ? "notIssued" : "alreadyCredited");
  }
  try {
    assertTransition("document", source.status, "credited");
  } catch (error) {
    if (error instanceof IllegalTransition) throw new CannotCredit("alreadyCredited");
    throw error;
  }

  const lines = await db
    .select()
    .from(documentLine)
    .where(eq(documentLine.documentId, opts.documentId))
    .orderBy(asc(documentLine.position));

  if (lines.filter((line) => line.lineKind === "item").length === 0) {
    throw new CannotCredit("nothingToCopy");
  }

  const issuedOn = opts.issuedOn ?? new Date().toISOString().slice(0, 10);

  const creditNoteId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(document)
      .values({
        kind: "credit_note",
        // LAW 5 — null until issue, like every other draft in this system.
        number: null,
        partyId: source.partyId,
        dealId: source.dealId,
        locale: source.locale,
        currency: source.currency,
        fxRate: source.fxRate,
        issuedOn,
        // An avoir asks for nothing, so it falls due on no day. A due date
        // here would put it in the ageing report as money somebody owes.
        dueOn: null,
        status: "draft",
        globalDiscountPct: source.globalDiscountPct,
        advanceDeducted: source.advanceDeducted,
        retentionPct: source.retentionPct,
        settlement: source.settlement,
        /*
          THE FIGURES ARE COPIED, NOT RECOMPUTED.

          A full credit says one thing: this invoice, entirely. Recomputing the
          totals from the copied lines would usually agree — and would quietly
          stop agreeing the day a VAT rate is superseded or the droit de timbre
          is confirmed between the invoice going out and the avoir being
          raised. An avoir whose total is not the invoice's total is an avoir
          that credits a sum nobody was ever billed, and it is the client's
          accountant who finds it. So the frozen figures come across whole.
        */
        stampDuty: source.stampDuty,
        totals: source.totals,
      })
      .returning({ id: document.id });

    const id = created?.id as string;

    /*
      The reason, on the paper.

      It is written to the audit entry below as well, but an avoir is a
      document somebody reads on its own two years later, and "annule la
      facture SUP/2026/0043 — erreur de quantité" has to be legible ON IT.
      A text line is how this engine says a sentence: it prints, it carries no
      money, and `computeTotals` ignores it.
    */
    await tx.insert(documentLine).values({
      documentId: id,
      position: 1,
      lineKind: "text",
      designation: reason,
    });

    await tx.insert(documentLine).values(
      lines.map((line, index) => ({
        documentId: id,
        position: index + 2,
        lineKind: line.lineKind,
        // An option was never billed, so there is nothing of it to credit —
        // but it is copied as it stood, because the avoir is a restatement of
        // the paper and a reader comparing the two must find the same rows.
        isOption: line.isOption,
        itemId: line.itemId,
        reference: line.reference,
        designation: line.designation,
        note: line.note,
        designationSource: line.designationSource,
        unit: line.unit,
        qty: line.qty,
        unitPrice: line.unitPrice,
        unitCost: line.unitCost,
        costSource: line.costSource,
        costQuoteId: line.costQuoteId,
        discountPct: line.discountPct,
        vatRate: line.vatRate,
        vatExemptRef: line.vatExemptRef,
        totalExcl: line.totalExcl,
      })),
    );

    /*
      `credits`, from the avoir to the invoice — the same direction `covers`
      runs in `bill.ts`: the new paper names the old one. The unique index
      `document_credited_once` is on the invoice's side of it, so two people
      cancelling the same invoice in the same second produce one avoir and one
      refusal, and the refusal costs no number because it happens here, before
      the engine is asked to issue anything.
    */
    await tx
      .insert(documentLink)
      .values({ fromDocument: id, toDocument: opts.documentId, relation: "credits" });

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "document",
      entityId: id,
      action: "create",
      reason,
      after: {
        kind: "credit_note",
        credits: opts.documentId,
        creditedNumber: source.number,
        creditedKind: source.kind,
        // Named, so the log answers "was a number handed out here?" without
        // anybody having to know that it was not. Same as `convertDocument`.
        number: null,
        numberReserved: false,
        linesCopied: lines.length,
        full: true,
      },
      sourceScreen: "18",
    });

    return id;
  });

  const rendered = await render({
    documentId: creditNoteId,
    purpose: "issue",
    actorId: opts.actorId,
  });

  await db.transaction(async (tx) => {
    const moved = await tx
      .update(document)
      .set({ status: "credited" })
      .where(and(eq(document.id, opts.documentId), eq(document.status, "issued")))
      .returning({ id: document.id });
    // Somebody credited it between the read at the top and here. The avoir is
    // issued and linked; refusing now would be refusing after the fact.
    if (moved.length !== 1) throw new CannotCredit("alreadyCredited");

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "document",
      entityId: opts.documentId,
      action: "credit",
      reason,
      before: { status: "issued", number: source.number },
      after: {
        status: "credited",
        // The invoice keeps its number. Saying so in the log is how the entry
        // answers the question somebody will actually ask of it.
        number: source.number,
        creditNote: creditNoteId,
        creditNoteNumber: rendered.number,
      },
      sourceScreen: "18",
    });
  });

  return { creditNoteId, number: rendered.number, rendered };
}
