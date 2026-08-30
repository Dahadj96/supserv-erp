import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine, priceQuote } from "@/db/schema/deal";
import { document, documentLine } from "@/db/schema/document";
import { sourcingLine, sourcingRequest, sourcingResponse } from "@/db/schema/sourcing";
import { bpuErratum, bpuMapping, tender } from "@/db/schema/tender";
import { assertTransition } from "../control/transitions";
import {
  type BpuLine,
  type BpuTotals,
  bpuTotals,
  diffBpu,
  keepsItsPrice,
  type LineChange,
  material,
  type PricedRow,
  priceDrift,
  readLine,
  summarise,
} from "./bpu";
import { type BpuMapping, missingTargets } from "./bpu-columns";

/**
 * Screen 42, against the database.
 *
 * THE BPU IS THE DEAL'S LINES. `deal_line` already holds the client's own
 * position, their reference, their designation, the quantity and the unit —
 * screen 06's note says so: "no client item codes stored, reference only". So
 * importing a bordereau is importing deal lines, and screen 62's importer is
 * what reads the spreadsheet. Nothing here parses a file.
 *
 * What is here is the part screen 62 has no reason to know about: what happens
 * when the buyer issues an erratum against lines that have already been priced.
 */

export class BpuRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "BpuRefused";
  }
}

export type BpuView = {
  dealId: string;
  partyId: string;
  ref: string;
  clientReference: string | null;
  object: string;
  currency: string;
  cautionPct: string | null;
  /** "read from BPU.xls". Null when the lines were typed, which is normal. */
  source: string | null;
  importedAt: Date | null;
  rows: PricedRow[];
  totals: BpuTotals;
  drift: ReturnType<typeof priceDrift>;
  /** Lines we have bought before, which is where the last-paid column comes from. */
  knownBefore: number;
  /** Lines a pending erratum would move. Nought when none has arrived. */
  changedByErratum: number;
  /** The draft offer these prices are going onto, when one has been started. */
  draftOfferId: string | null;
};

/** The client's lines, with what each one costs and what we intend to charge. */
export async function bpu(dealId: string): Promise<BpuView | null> {
  const [found] = await db
    .select({
      id: deal.id,
      partyId: deal.partyId,
      ref: deal.ref,
      clientReference: deal.clientReference,
      object: deal.subject,
      currency: deal.currency,
      cautionPct: tender.cautionPct,
      source: tender.bpuSource,
      importedAt: tender.bpuImportedAt,
    })
    .from(deal)
    .leftJoin(tender, eq(tender.dealId, deal.id))
    .where(eq(deal.id, dealId))
    .limit(1);
  if (!found) return null;

  const lines = await db
    .select()
    .from(dealLine)
    .where(eq(dealLine.dealId, dealId))
    .orderBy(asc(dealLine.position));

  if (lines.length === 0) {
    const rows: PricedRow[] = [];
    return {
      dealId,
      partyId: found.partyId,
      ref: found.ref,
      clientReference: found.clientReference,
      object: found.object,
      currency: found.currency,
      cautionPct: found.cautionPct,
      source: found.source,
      importedAt: found.importedAt,
      rows,
      totals: bpuTotals(rows, found.cautionPct),
      drift: null,
      knownBefore: 0,
      changedByErratum: 0,
      draftOfferId: null,
    };
  }

  const lineIds = lines.map((l) => l.id);
  const today = new Date().toISOString().slice(0, 10);

  /**
   * The best cost we hold for each line today, and whether a supplier has been
   * asked and not answered. Two queries, not one per line: a BPU is forty-two
   * rows and can be four hundred.
   */
  const [costs, waiting, lastPaid, priced] = await Promise.all([
    db
      .select({
        dealLineId: priceQuote.dealLineId,
        price: sql<string>`min(${priceQuote.price})::text`,
      })
      .from(priceQuote)
      .where(
        and(
          inArray(priceQuote.dealLineId, lineIds),
          // A stale price is not a cost. `valid_until` is how a quote stops
          // counting — an erratum stamps it on every price for a line it
          // reworded, and a supplier's own expiry date stamps it too.
          or(isNull(priceQuote.validUntil), gte(priceQuote.validUntil, today)),
        ),
      )
      .groupBy(priceQuote.dealLineId),

    db
      .select({ dealLineId: sourcingLine.dealLineId })
      .from(sourcingLine)
      .innerJoin(sourcingResponse, eq(sourcingResponse.id, sourcingLine.responseId))
      .innerJoin(sourcingRequest, eq(sourcingRequest.id, sourcingResponse.requestId))
      .where(
        and(
          inArray(sourcingLine.dealLineId, lineIds),
          isNotNull(sourcingRequest.sentAt),
          eq(sourcingResponse.status, "asked"),
        ),
      ),

    lastPaidFor(lines.map((l) => l.itemId).filter((id): id is string => id !== null)),

    // What is already on an offer for this enquiry, per enquiry line.
    db
      .select({ dealLineId: documentLine.dealLineId, unitPrice: documentLine.unitPrice })
      .from(documentLine)
      .innerJoin(document, eq(document.id, documentLine.documentId))
      .where(and(eq(document.dealId, dealId), inArray(document.kind, ["quotation", "proforma"]))),
  ]);

  const costOf = new Map(costs.map((c) => [c.dealLineId, c.price]));
  const asked = new Set(waiting.map((w) => w.dealLineId));
  const offered = new Map(
    priced.filter((p) => p.dealLineId).map((p) => [p.dealLineId as string, p.unitPrice]),
  );

  const rows = lines.map((line) =>
    readLine({
      position: line.position,
      reference: line.reference,
      designation: line.designation,
      unit: line.unit,
      qty: line.qty,
      lastPaid: line.itemId ? (lastPaid.get(line.itemId) ?? null) : null,
      cost: costOf.get(line.id) ?? null,
      ourPrice: offered.get(line.id) ?? null,
      awaitingQuote: asked.has(line.id),
    }),
  );

  /** Where "build the financial offer" goes, when there is already a draft. */
  const [draft] = await db
    .select({ id: document.id })
    .from(document)
    .where(
      and(eq(document.dealId, dealId), eq(document.kind, "quotation"), isNull(document.number)),
    )
    .orderBy(desc(document.createdAt))
    .limit(1);

  const [erratum] = await db
    .select({ lines: bpuErratum.lines })
    .from(bpuErratum)
    .where(and(eq(bpuErratum.dealId, dealId), eq(bpuErratum.status, "pending")))
    .orderBy(desc(bpuErratum.addedAt))
    .limit(1);

  return {
    dealId,
    partyId: found.partyId,
    ref: found.ref,
    clientReference: found.clientReference,
    object: found.object,
    currency: found.currency,
    cautionPct: found.cautionPct,
    source: found.source,
    importedAt: found.importedAt,
    rows,
    totals: bpuTotals(rows, found.cautionPct),
    drift: priceDrift(rows),
    knownBefore: rows.filter((row) => row.lastPaid !== null).length,
    changedByErratum: erratum
      ? material(
          diffBpu(
            lines.map((line) => ({
              position: line.position,
              reference: line.reference,
              designation: line.designation,
              unit: line.unit,
              qty: line.qty,
            })),
            erratum.lines as BpuLine[],
          ),
        ).length
      : 0,
    draftOfferId: draft?.id ?? null,
  };
}

/**
 * "Apply last prices."
 *
 * The banner offers it because eleven of the forty-two lines are articles we
 * have bought before, and starting from nothing when the file already says
 * 1 840 is retyping by another name.
 *
 * What it writes is an INTERNAL COSTING, not a supplier's quote — `source` is
 * the value the schema reserves for "that one is us" — and it writes one only
 * where no cost is held at all. Overwriting a price a supplier actually gave
 * with a figure from November would be worse than leaving the line empty.
 */
export async function applyLastPrices(opts: {
  dealId: string;
  actorId: string;
}): Promise<{ applied: number }> {
  const view = await bpu(opts.dealId);
  if (!view) throw new BpuRefused("noSuchDeal");

  const rows = await db
    .select({ id: dealLine.id, position: dealLine.position, itemId: dealLine.itemId })
    .from(dealLine)
    .where(eq(dealLine.dealId, opts.dealId));
  const idOf = new Map(rows.map((row) => [row.position, row]));

  const candidates = view.rows.filter((row) => row.lastPaid !== null && row.cost === null);
  if (candidates.length === 0) return { applied: 0 };

  await db.transaction(async (tx) => {
    await tx.insert(priceQuote).values(
      candidates.map((row) => ({
        itemId: idOf.get(row.position)?.itemId ?? null,
        dealLineId: idOf.get(row.position)?.id ?? null,
        dealId: opts.dealId,
        designation: row.designation,
        source: "internal_costing",
        partyId: null,
        price: row.lastPaid as string,
        currency: view.currency,
        capturedBy: opts.actorId,
      })),
    );

    await tx.insert(auditEntry).values({
      entity: "deal",
      entityId: opts.dealId,
      action: "applyLastPrices",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "42",
      after: { lines: candidates.map((row) => row.position) },
    });
  });

  return { applied: candidates.length };
}

/**
 * What we last actually paid for each of these articles.
 *
 * From `document_line.unit_cost` on issued documents, not from `price_quote`:
 * a quote is what somebody said it would cost, and this column is what went on
 * a document. "The last price we paid" has to mean paid.
 */
async function lastPaidFor(itemIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (itemIds.length === 0) return out;

  const rows = await db
    .select({
      itemId: documentLine.itemId,
      unitCost: documentLine.unitCost,
      issuedOn: document.issuedOn,
    })
    .from(documentLine)
    .innerJoin(document, eq(document.id, documentLine.documentId))
    .where(
      and(
        inArray(documentLine.itemId, itemIds),
        isNotNull(documentLine.unitCost),
        isNotNull(document.number),
      ),
    )
    .orderBy(desc(document.issuedOn));

  for (const row of rows) {
    if (row.itemId && !out.has(row.itemId)) out.set(row.itemId, row.unitCost as string);
  }
  return out;
}

/* ----------------------------------------------------------- the erratum */

export type ErratumReview = {
  changes: LineChange[];
  /** The ones a person has to look at. `changes` minus the unchanged. */
  material: LineChange[];
  summary: ReturnType<typeof summarise>;
  /**
   * Numbers of offers already ISSUED against this enquiry.
   *
   * LAW 5: an issued document does not change. If a quotation went out against
   * the previous bordereau, applying the erratum does not amend it and cannot —
   * the client is holding a piece of paper that quotes the old quantities. That
   * is a fact worth a sentence on the screen and an acknowledgement before the
   * lines move underneath it, not something to discover at the opening.
   */
  issuedOffers: string[];
  /** Draft offer lines that will lose their price, because their line does. */
  draftLinesLosingPrice: number;
};

/** What this erratum would do. Reads only. */
export async function reviewErratum(
  dealId: string,
  incoming: BpuLine[],
): Promise<ErratumReview | null> {
  const held = await heldLines(dealId);
  if (held === null) return null;

  const changes = diffBpu(
    held.map((line) => line.line),
    incoming,
  );
  const byPosition = new Map(held.map((line) => [line.line.position, line.id]));
  const losing = changes
    .filter(
      (change) =>
        !keepsItsPrice(change.kind) && change.kind !== "added" && change.kind !== "removed",
    )
    .map((change) => byPosition.get(change.position))
    .filter((id): id is string => id !== undefined);

  const [offers, draftLines] = await Promise.all([
    db
      .select({ number: document.number })
      .from(document)
      .where(
        and(
          eq(document.dealId, dealId),
          inArray(document.kind, ["quotation", "proforma"]),
          isNotNull(document.number),
        ),
      ),
    losing.length === 0
      ? Promise.resolve([] as { id: string }[])
      : db
          .select({ id: documentLine.id })
          .from(documentLine)
          .innerJoin(document, eq(document.id, documentLine.documentId))
          .where(
            and(
              eq(document.dealId, dealId),
              isNull(document.number),
              isNotNull(documentLine.unitPrice),
              inArray(documentLine.dealLineId, losing),
            ),
          ),
  ]);

  return {
    changes,
    material: material(changes),
    summary: summarise(changes),
    issuedOffers: offers.map((offer) => offer.number as string),
    draftLinesLosingPrice: draftLines.length,
  };
}

export type ErratumResult = {
  added: number;
  removed: number;
  updated: number;
  /** Supplier prices marked stale, because the line they were given for changed. */
  quotesExpired: number;
  /** Draft offer lines whose price was cleared. */
  draftPricesCleared: number;
};

/**
 * Apply it.
 *
 * THIS TOUCHES THE DEAL'S LINES AND NOTHING ELSE THAT CARRIES A NUMBER.
 *
 * A line that keeps its price (unchanged, or only its quantity moved) is left
 * with everything attached to it. A line that does not — a redesignation, a
 * unit change — has its supplier prices EXPIRED rather than deleted:
 * `valid_until` is stamped at the day the erratum was applied, which is the
 * mechanism the schema already describes — "after this date the price is stale
 * and screens say so. Never auto-deleted." What a supplier said a DN80 valve
 * cost in August is evidence, and an erratum from the buyer is not a reason to
 * destroy it. The line simply stops counting it as a cost.
 *
 * Not detached — `deal_line_id` set to null — although the schema's own comment
 * about surviving a deleted enquiry suggested it. `price_quote_has_a_subject`
 * refuses a row with neither an item nor a line, and a bordereau line that
 * nobody has matched to the catalogue has no item. Detaching would work for the
 * matched lines and throw for the rest, which is the worst of both.
 *
 * The same line's price on a DRAFT offer is cleared, because the screen reads
 * `our price` from there and a redesignated line still showing the old figure
 * is the screen telling somebody something untrue. Issued offers are not
 * touched — that is LAW 5, and it is why `acknowledgeIssued` exists.
 */
export async function applyErratum(opts: {
  dealId: string;
  incoming: BpuLine[];
  actorId: string;
  reason?: string | null;
  /** Required when an offer has already gone out against the old bordereau. */
  acknowledgeIssued?: boolean;
  now?: Date;
}): Promise<ErratumResult> {
  const review = await reviewErratum(opts.dealId, opts.incoming);
  if (!review) throw new BpuRefused("noSuchDeal");
  if (review.material.length === 0) throw new BpuRefused("nothingChanged");
  if (review.issuedOffers.length > 0 && !opts.acknowledgeIssued) {
    throw new BpuRefused("offerAlreadyIssued");
  }

  const held = await heldLines(opts.dealId);
  if (held === null) throw new BpuRefused("noSuchDeal");
  const idOf = new Map(held.map((line) => [line.line.position, line.id]));

  const result: ErratumResult = {
    added: 0,
    removed: 0,
    updated: 0,
    quotesExpired: 0,
    draftPricesCleared: 0,
  };

  const staleFrom = (opts.now ?? new Date()).toISOString().slice(0, 10);

  await db.transaction(async (tx) => {
    for (const change of review.material) {
      const id = idOf.get(change.position);

      if (change.kind === "added" && change.after) {
        await tx.insert(dealLine).values({
          dealId: opts.dealId,
          position: change.after.position,
          reference: change.after.reference,
          designation: change.after.designation,
          unit: change.after.unit,
          qty: change.after.qty,
        });
        result.added += 1;
        continue;
      }

      if (change.kind === "removed" && id) {
        await tx.delete(dealLine).where(eq(dealLine.id, id));
        result.removed += 1;
        continue;
      }

      if (!id || !change.after) continue;

      await tx
        .update(dealLine)
        .set({
          qty: change.after.qty,
          designation: change.after.designation,
          unit: change.after.unit,
          reference: change.after.reference,
        })
        .where(eq(dealLine.id, id));
      result.updated += 1;

      if (keepsItsPrice(change.kind)) continue;

      const expired = await tx
        .update(priceQuote)
        .set({ validUntil: staleFrom })
        .where(eq(priceQuote.dealLineId, id))
        .returning({ id: priceQuote.id });
      result.quotesExpired += expired.length;

      const cleared = await tx
        .update(documentLine)
        .set({ unitPrice: null })
        .where(
          and(
            eq(documentLine.dealLineId, id),
            isNotNull(documentLine.unitPrice),
            inArray(
              documentLine.documentId,
              tx
                .select({ id: document.id })
                .from(document)
                .where(and(eq(document.dealId, opts.dealId), isNull(document.number))),
            ),
          ),
        )
        .returning({ id: documentLine.id });
      result.draftPricesCleared += cleared.length;
    }

    await tx.insert(auditEntry).values({
      entity: "deal",
      entityId: opts.dealId,
      action: "erratum",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "42",
      reason: opts.reason?.trim() || null,
      before: { lines: held.map((line) => line.line) },
      after: {
        summary: review.summary,
        changed: review.material.map((change) => ({
          position: change.position,
          kind: change.kind,
          from: change.from ?? null,
          to: change.to ?? null,
        })),
        issuedOffers: review.issuedOffers,
        acknowledgedIssued: review.issuedOffers.length > 0 ? true : undefined,
        ...result,
      },
    });
  });

  return result;
}

/** The client's lines as the diff wants them, with their ids alongside. */
async function heldLines(dealId: string): Promise<{ id: string; line: BpuLine }[] | null> {
  const [found] = await db.select({ id: deal.id }).from(deal).where(eq(deal.id, dealId)).limit(1);
  if (!found) return null;

  const rows = await db
    .select()
    .from(dealLine)
    .where(eq(dealLine.dealId, dealId))
    .orderBy(asc(dealLine.position));

  return rows.map((row) => ({
    id: row.id,
    line: {
      position: row.position,
      reference: row.reference,
      designation: row.designation,
      unit: row.unit,
      qty: row.qty,
    },
  }));
}

/* ------------------------------------------- the mapping, and the import */

/** What this client's bordereau looked like the last time somebody confirmed it. */
export async function rememberedMapping(partyId: string): Promise<BpuMapping | null> {
  const [row] = await db.select().from(bpuMapping).where(eq(bpuMapping.partyId, partyId)).limit(1);
  return row ? (row.mapping as BpuMapping) : null;
}

/** Confirmed by a person, which is the only way a mapping is ever stored. */
export async function saveMapping(opts: {
  partyId: string;
  mapping: BpuMapping;
  actorId: string;
}): Promise<void> {
  if (missingTargets(opts.mapping).length > 0) throw new BpuRefused("mappingIncomplete");

  await db.transaction(async (tx) => {
    await tx
      .insert(bpuMapping)
      .values({ partyId: opts.partyId, mapping: opts.mapping, confirmedBy: opts.actorId })
      .onConflictDoUpdate({
        target: bpuMapping.partyId,
        set: { mapping: opts.mapping, confirmedBy: opts.actorId, confirmedAt: new Date() },
      });

    await tx.insert(auditEntry).values({
      entity: "bpu_mapping",
      entityId: opts.partyId,
      action: "confirm",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "42",
      after: opts.mapping,
    });
  });
}

/**
 * The first load of a bordereau.
 *
 * REFUSED WHEN THE DEAL ALREADY HAS LINES, and that refusal is the whole
 * safety of this screen. A second file against a priced bordereau is an
 * erratum — it goes through `recordErratum` and is reviewed line by line — and
 * quietly replacing forty-two lines because somebody uploaded again is how
 * thirty-one gathered prices disappear without a trace.
 */
export async function importBpu(opts: {
  dealId: string;
  lines: BpuLine[];
  filename?: string | null;
  actorId: string;
}): Promise<{ imported: number }> {
  if (opts.lines.length === 0) throw new BpuRefused("nothingToImport");

  const held = await heldLines(opts.dealId);
  if (held === null) throw new BpuRefused("noSuchDeal");
  if (held.length > 0) throw new BpuRefused("alreadyImported");

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(dealLine).values(
      opts.lines.map((line) => ({
        dealId: opts.dealId,
        position: line.position,
        reference: line.reference,
        designation: line.designation,
        unit: line.unit,
        qty: line.qty,
      })),
    );

    await tx
      .update(tender)
      .set({ bpuSource: opts.filename ?? null, bpuImportedAt: now })
      .where(eq(tender.dealId, opts.dealId));

    await tx.insert(auditEntry).values({
      entity: "deal",
      entityId: opts.dealId,
      action: "importBpu",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "42",
      after: { filename: opts.filename ?? null, lines: opts.lines.length },
    });
  });

  return { imported: opts.lines.length };
}

/* -------------------------------------------------- errata, as they land */

export type ErratumRow = {
  id: string;
  filename: string | null;
  receivedOn: string | null;
  addedAt: Date;
  lines: BpuLine[];
  review: ErratumReview;
};

/** The erratum waiting to be applied, if one has arrived. */
export async function pendingErratum(dealId: string): Promise<ErratumRow | null> {
  const [row] = await db
    .select()
    .from(bpuErratum)
    .where(and(eq(bpuErratum.dealId, dealId), eq(bpuErratum.status, "pending")))
    .orderBy(desc(bpuErratum.addedAt))
    .limit(1);
  if (!row) return null;

  const lines = row.lines as BpuLine[];
  const review = await reviewErratum(dealId, lines);
  if (!review) return null;

  return {
    id: row.id,
    filename: row.filename,
    receivedOn: row.receivedOn,
    addedAt: row.addedAt,
    lines,
    review,
  };
}

/** File it. Nothing moves until somebody applies it. */
export async function recordErratum(opts: {
  dealId: string;
  lines: BpuLine[];
  filename?: string | null;
  receivedOn?: string | null;
  actorId: string;
}): Promise<{ id: string }> {
  if (opts.lines.length === 0) throw new BpuRefused("nothingToImport");

  const held = await heldLines(opts.dealId);
  if (held === null) throw new BpuRefused("noSuchDeal");
  if (held.length === 0) throw new BpuRefused("nothingImportedYet");

  const already = await pendingErratum(opts.dealId);
  if (already) throw new BpuRefused("erratumAlreadyPending");

  const [row] = await db
    .insert(bpuErratum)
    .values({
      dealId: opts.dealId,
      lines: opts.lines,
      filename: opts.filename ?? null,
      receivedOn: opts.receivedOn ?? null,
      addedBy: opts.actorId,
    })
    .returning({ id: bpuErratum.id });

  if (!row) throw new BpuRefused("nothingToImport");
  return { id: row.id };
}

/** Review it, apply it, and mark the row so it is not applied twice. */
export async function applyPendingErratum(opts: {
  erratumId: string;
  actorId: string;
  reason?: string | null;
  acknowledgeIssued?: boolean;
}): Promise<ErratumResult> {
  const [row] = await db
    .select()
    .from(bpuErratum)
    .where(eq(bpuErratum.id, opts.erratumId))
    .limit(1);
  if (!row) throw new BpuRefused("noSuchErratum");
  if (row.status !== "pending") throw new BpuRefused("erratumNotPending");
  assertTransition("bpu_erratum", row.status, "applied");

  const result = await applyErratum({
    dealId: row.dealId,
    incoming: row.lines as BpuLine[],
    actorId: opts.actorId,
    reason: opts.reason,
    acknowledgeIssued: opts.acknowledgeIssued,
  });

  await db
    .update(bpuErratum)
    .set({
      status: "applied",
      appliedBy: opts.actorId,
      appliedAt: new Date(),
      reason: opts.reason?.trim() || null,
    })
    .where(eq(bpuErratum.id, opts.erratumId));

  return result;
}

/**
 * Thrown away, with a reason.
 *
 * A buyer does send an erratum and then withdraw it. The row stays — it is
 * evidence that a corrected bordereau arrived on the 14th — and the reason
 * says who decided it did not apply.
 */
export async function discardErratum(opts: {
  erratumId: string;
  actorId: string;
  reason: string;
}): Promise<void> {
  if (!opts.reason.trim()) throw new BpuRefused("reasonRequired");

  const [row] = await db
    .select({ id: bpuErratum.id, dealId: bpuErratum.dealId, status: bpuErratum.status })
    .from(bpuErratum)
    .where(eq(bpuErratum.id, opts.erratumId))
    .limit(1);
  if (!row) throw new BpuRefused("noSuchErratum");
  if (row.status !== "pending") throw new BpuRefused("erratumNotPending");
  assertTransition("bpu_erratum", row.status, "discarded");

  await db.transaction(async (tx) => {
    await tx
      .update(bpuErratum)
      .set({ status: "discarded", discardedAt: new Date(), reason: opts.reason.trim() })
      .where(eq(bpuErratum.id, opts.erratumId));

    await tx.insert(auditEntry).values({
      entity: "bpu_erratum",
      entityId: opts.erratumId,
      action: "discard",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "42",
      reason: opts.reason.trim(),
      after: { dealId: row.dealId },
    });
  });
}
