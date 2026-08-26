import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal } from "@/db/schema/deal";
import { document, documentLine } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import { marginPct, summariseMargin } from "./margin";
import { type SubmitFacts, submitChecks } from "./submit";

/**
 * Screens 11 and 12 — reading and saving an offer.
 *
 * Line editing goes through `src/documents/draft.ts`, which is the only file
 * that writes `document_line` — one door in, so one place knows the rules. What
 * lives here is the offer-shaped view over it: cost, margin, and the checks.
 */

export class OfferRefused extends Error {
  constructor(readonly reason: "noSuchOffer" | "alreadyIssued" | "blocked") {
    super(reason);
  }
}

/** Screen 11 — the list. */
export async function listOffers(opts: { limit?: number } = {}) {
  const rows = await db
    .select({
      id: document.id,
      number: document.number,
      kind: document.kind,
      status: document.status,
      currency: document.currency,
      createdAt: document.createdAt,
      issuedOn: document.issuedOn,
      validDays: document.validDays,
      dealRef: deal.ref,
      dealId: deal.id,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
    })
    .from(document)
    .innerJoin(party, eq(party.id, document.partyId))
    .leftJoin(deal, eq(deal.id, document.dealId))
    .where(inArray(document.kind, ["quotation", "proforma"]))
    .orderBy(desc(document.createdAt))
    .limit(opts.limit ?? 100);

  const totals = await db
    .select({
      documentId: documentLine.documentId,
      cost: sql<string>`coalesce(sum(${documentLine.unitCost} * ${documentLine.qty}), 0)::text`,
      excl: sql<string>`coalesce(sum(${documentLine.unitPrice} * ${documentLine.qty}), 0)::text`,
    })
    .from(documentLine)
    .where(
      inArray(
        documentLine.documentId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(documentLine.documentId);

  const byDocument = new Map(totals.map((t) => [t.documentId, t] as const));

  return rows.map((row) => {
    const total = byDocument.get(row.id);
    return {
      ...row,
      totalExcl: total?.excl ?? "0",
      totalCost: total?.cost ?? "0",
      // Computed here, exactly as on the builder. There is no stored margin
      // anywhere for the two to drift apart from.
      marginPct: marginPct(total?.cost ?? null, total?.excl ?? null),
    };
  });
}

/** Screen 12 — everything the builder needs, in one read. */
export async function getOffer(id: string) {
  const [row] = await db
    .select({
      document,
      dealRef: deal.ref,
      dealId: deal.id,
      clientReference: deal.clientReference,
      clientId: party.id,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      clientNif: party.nif,
      submissionMethod: deal.submissionMethod,
      requiredValidityDays: deal.requiredValidityDays,
    })
    .from(document)
    .innerJoin(party, eq(party.id, document.partyId))
    .leftJoin(deal, eq(deal.id, document.dealId))
    .where(eq(document.id, id))
    .limit(1);
  if (!row) return null;

  const lines = await db
    .select()
    .from(documentLine)
    .where(eq(documentLine.documentId, id))
    .orderBy(documentLine.position);

  const summary = summariseMargin(
    lines.map((l) => ({
      unitCost: l.unitCost,
      unitPrice: l.unitPrice,
      qty: l.qty,
      isOption: l.isOption,
      lineKind: l.lineKind,
    })),
  );

  const submission = (row.document.renderSnapshot ?? {}) as {
    submittedAt?: string;
    proofRef?: string;
    place?: string;
  };

  const facts: SubmitFacts = {
    clientNif: row.clientNif,
    clientId: row.clientId,
    lines: lines
      .filter((l) => l.lineKind === "item")
      .map((l) => ({ unitPrice: l.unitPrice, unitCost: l.unitCost })),
    submissionMethod: row.submissionMethod ?? "unknown",
    submittedAt: submission.submittedAt ? new Date(submission.submittedAt) : null,
    proofRef: submission.proofRef ?? null,
    validDays: row.document.validDays,
    requiredValidityDays: row.requiredValidityDays,
  };

  return { ...row, lines, summary, submission, checks: submitChecks(facts) };
}

/**
 * "Mark as submitted."
 *
 * NOT the same as issuing. Issuing is the document engine allocating a number
 * under LAW 5; submitting is recording that the envelope was handed over at the
 * bureau des achats at 09:30 with a receipt. The two happen minutes apart and
 * are different facts — an offer can be issued and never submitted, which is
 * exactly what happens when somebody misses the deposit window.
 */
export async function markSubmitted(opts: {
  offerId: string;
  place: string | null;
  proofRef: string | null;
  when: Date;
  actorId: string;
}): Promise<void> {
  const [row] = await db
    .select({ id: document.id, snapshot: document.renderSnapshot })
    .from(document)
    .where(eq(document.id, opts.offerId))
    .limit(1);
  if (!row) throw new OfferRefused("noSuchOffer");

  const before = (row.snapshot ?? {}) as Record<string, unknown>;

  await db
    .update(document)
    .set({
      renderSnapshot: {
        ...before,
        submittedAt: opts.when.toISOString(),
        place: opts.place,
        proofRef: opts.proofRef,
      },
    })
    .where(eq(document.id, opts.offerId));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "document",
    entityId: opts.offerId,
    action: "update",
    after: {
      submitted: true,
      at: opts.when.toISOString(),
      place: opts.place,
      // Recorded as its own fact so "we submitted but kept no receipt" is
      // answerable years later, which is when it gets asked.
      proofRef: opts.proofRef,
    },
    sourceScreen: "12",
  });
}

/** Screen 11's "Offers on this enquiry". */
export async function offersForDeal(dealId: string) {
  return db
    .select({
      id: document.id,
      number: document.number,
      status: document.status,
      kind: document.kind,
      createdAt: document.createdAt,
    })
    .from(document)
    .where(and(eq(document.dealId, dealId), inArray(document.kind, ["quotation", "proforma"])))
    .orderBy(desc(document.createdAt));
}

/** Offers not yet issued, for the list's default view. */
export async function draftOffers() {
  return db
    .select({ id: document.id })
    .from(document)
    .where(and(inArray(document.kind, ["quotation", "proforma"]), isNull(document.number)));
}
