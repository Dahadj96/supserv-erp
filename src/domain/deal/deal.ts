import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine, priceQuote } from "@/db/schema/deal";
import { document } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import { sourcingRequest, sourcingResponse } from "@/db/schema/sourcing";
import {
  badgeOf,
  type DealFacts,
  deadlineDisplay,
  isOpen,
  type Outcome,
  type Stage,
  stageOf,
} from "./stage";

/**
 * Screens 05 and 06 — the enquiry, from the outside.
 *
 * Nothing in this file writes a stage. The counts that produce one are fetched
 * with the list (`factsFor`), which is the price of LAW 1 and is paid here once
 * rather than by every caller.
 */

/** How the client wants the offer delivered. Screen 06's red banner reads this. */
export const SUBMISSION_METHODS = [
  "email",
  "deposit_sealed",
  "portal",
  "hand_delivered",
  "unknown",
] as const;
export type SubmissionMethod = (typeof SUBMISSION_METHODS)[number];

/**
 * The reasons screen 06 offers for a no-bid, as a closed list.
 *
 * "Recorded so we can learn from it" is only true if the reasons can be counted,
 * and free text cannot be counted. A person may still add words — `decisionNote`
 * — but the reason itself is one of these five.
 */
export const NO_BID_REASONS = [
  "noSupplier",
  "deadlineImpossible",
  "outsideQualification",
  "paymentTerms",
  "priceNotCompetitive",
] as const;
export type NoBidReason = (typeof NO_BID_REASONS)[number];

export const dealInput = z.object({
  partyId: z.string().uuid(),
  subject: z.string().trim().min(1),
  contactPersonId: z.string().uuid().nullable().default(null),
  clientReference: z.string().trim().nullable().default(null),
  receivedAt: z.date().default(() => new Date()),
  deadlineAt: z.date().nullable().default(null),
  submissionMethod: z.enum(SUBMISSION_METHODS).default("unknown"),
  currency: z.string().trim().default("DZD"),
  /*
    A USER ID, WHICH IS NOT A UUID, AND NEVER WAS.

    `partyId` and `contactPersonId` above are `uuid` columns of ours, so `.uuid()`
    is right for them. `owner_id` is `text`, because it holds Better Auth's own
    id — `QueteTlhahi4jRKa4HM3f5M0DEtJ8YTb`, a 32-character nanoid. Demanding a
    UUID here meant `createDeal` threw on every call that named a real signed-in
    person, which is every call a screen can make:

        deals/new/actions.ts   ownerId: session.userId
        intake/commit.ts       ownerId: opts.actorId

    So an enquiry could not be created by ANY route, from either screen, and the
    only sign of it was "The server did not respond" on a red panel. Three days
    were spent on the two dead ends in front of it before anything could get far
    enough to hit this one.

    Every test passed `ownerId: null`, so the rule was never once exercised.
  */
  ownerId: z.string().trim().min(1, "ownerIdRequired").nullable().default(null),
  source: z.string().trim().default("manual"),
  intakeMessageId: z.string().uuid().nullable().default(null),
  expectedValue: z.string().trim().nullable().default(null),
  clientInstructions: z.string().nullable().default(null),
});
export type DealInput = z.infer<typeof dealInput>;

/**
 * `ENQ-2026-0141`.
 *
 * NOT a document number. LAW 5's three rules — allocate at issue, never reuse,
 * immutable after — are about documents a counterparty holds a copy of, and an
 * enquiry reference is an internal handle we invent when the email arrives.
 * So it is allocated on creation, and a gap in the sequence means somebody
 * deleted a draft enquiry, which is fine and explains itself.
 *
 * The max is taken inside the transaction that inserts, so two people opening
 * two emails at the same second cannot both get 0141.
 */
export async function nextDealRef(tx: typeof db, when: Date): Promise<string> {
  const year = when.getFullYear();
  const prefix = `ENQ-${year}-`;
  const [row] = await tx
    .select({ last: sql<string | null>`max(${deal.ref})` })
    .from(deal)
    .where(sql`${deal.ref} like ${`${prefix}%`}`);

  const lastNumber = row?.last ? Number(row.last.slice(prefix.length)) : 0;
  return `${prefix}${String(lastNumber + 1).padStart(4, "0")}`;
}

export async function createDeal(input: DealInput, actorId: string): Promise<string> {
  const parsed = dealInput.parse(input);

  return db.transaction(async (tx) => {
    const ref = await nextDealRef(tx as unknown as typeof db, parsed.receivedAt);

    const [created] = await tx
      .insert(deal)
      .values({
        ref,
        partyId: parsed.partyId,
        contactPersonId: parsed.contactPersonId,
        subject: parsed.subject,
        clientReference: parsed.clientReference,
        receivedAt: parsed.receivedAt,
        deadlineAt: parsed.deadlineAt,
        submissionMethod: parsed.submissionMethod,
        currency: parsed.currency,
        ownerId: parsed.ownerId,
        source: parsed.source,
        intakeMessageId: parsed.intakeMessageId,
        expectedValue: parsed.expectedValue,
        clientInstructions: parsed.clientInstructions,
      })
      .returning({ id: deal.id });

    const id = created?.id as string;

    await tx.insert(auditEntry).values({
      actorId,
      actorKind: "user",
      entity: "deal",
      entityId: id,
      action: "create",
      after: { ref, partyId: parsed.partyId, subject: parsed.subject, source: parsed.source },
      sourceScreen: "05",
    });

    return id;
  });
}

/**
 * The document kinds each count in `DealFacts` is looking for.
 *
 * `quotation` and `proforma` are both "an offer went out" — the client has a
 * priced document in their hand either way, and which one they asked for is a
 * detail of their purchasing rules, not a difference in how far along we are.
 *
 * `client_order` is their purchase order arriving. That is what winning looks
 * like from inside this system, and it is the only thing that sets `won`.
 */
const OFFER_KINDS = ["quotation", "proforma"];
const ORDER_KINDS = ["client_order"];
/**
 * The bon de livraison, and only ours.
 *
 * `goods_receipt` is the buy side — what a supplier delivered TO us — and it is
 * not a step in the enquiry run, so it is not here. One kind rather than a list
 * because there is one: `can.ts` maps `delivery_note` to `deliveries.issue` and
 * nothing else answers that question.
 */
const DELIVERY_KINDS = ["delivery_note"];
const INVOICE_KINDS = ["invoice", "advance_invoice", "situation"];

/**
 * The counts behind the derived stage, for a set of deals, in one query each.
 *
 * `number is not null` on the offer and invoice counts is doing real work: a
 * draft has no number (LAW 5), and a draft offer sitting in somebody's tab is
 * not an offer out. That distinction is the difference between a pipeline
 * report you can trust and one everybody quietly discounts.
 *
 * `suppliersAsked` counts suppliers on SENT requests only. A request sitting in
 * a draft, with four suppliers picked and no message gone out, is not sourcing
 * — it is somebody thinking about sourcing, and the distinction is the same one
 * `offersIssued` draws between a draft offer and an offer out.
 */
/** What `factsFor` counts: everything on `DealFacts` that is not on the row. */
export type DealCounts = Omit<DealFacts, "decision" | "lostAt" | "lineCount">;

/**
 * A deal nothing has happened to yet.
 *
 * Exported and used by every caller that needs a fallback, rather than written
 * out at each of the four. It was four copies of the same object literal until
 * task 2.6 added two counts to `DealFacts` and the compiler found all four —
 * which is the cheap version of this lesson. The expensive version is a fifth
 * count added one day to three of them.
 */
export const NO_COUNTS: DealCounts = {
  suppliersAsked: 0,
  priceQuotes: 0,
  offersIssued: 0,
  ordersReceived: 0,
  deliveriesIssued: 0,
  invoicesIssued: 0,
};

export async function factsFor(dealIds: string[]): Promise<Map<string, DealCounts>> {
  const out = new Map<string, DealCounts>();
  if (dealIds.length === 0) return out;

  for (const id of dealIds) out.set(id, { ...NO_COUNTS });

  const rows = await db
    .select({
      dealId: document.dealId,
      kind: document.kind,
      issued: sql<number>`count(*) filter (where ${document.number} is not null)::int`,
      recorded: sql<number>`count(*) filter (where ${document.status} = 'issued')::int`,
    })
    .from(document)
    .where(
      and(
        inArray(sql`${document.dealId}`, dealIds),
        inArray(document.kind, [
          ...OFFER_KINDS,
          ...ORDER_KINDS,
          ...DELIVERY_KINDS,
          ...INVOICE_KINDS,
        ]),
      ),
    )
    .groupBy(document.dealId, document.kind);

  for (const row of rows) {
    const facts = row.dealId ? out.get(row.dealId) : undefined;
    if (!facts) continue;
    if (OFFER_KINDS.includes(row.kind)) facts.offersIssued += row.issued;
    // A client's own purchase order is not numbered by us — its number is
    // theirs (see the `clientReference` numbering rule on screen 50) — so this
    // one counts RECORDED rows (issued, under their reference), not numbered
    // ones. Not every row: a draft order nobody has confirmed is not a win.
    if (ORDER_KINDS.includes(row.kind)) facts.ordersReceived += row.recorded;
    if (DELIVERY_KINDS.includes(row.kind)) facts.deliveriesIssued += row.issued;
    if (INVOICE_KINDS.includes(row.kind)) facts.invoicesIssued += row.issued;
  }

  /**
   * Prices held against the deal.
   *
   * Its own query rather than a join onto the one above, because a price is not
   * a document — it is a row somebody captured from an email, a proforma, or a
   * shop counter in Adrar, and `price_quote.deal_id` is `on delete set null` so
   * that a price outlives the enquiry it was gathered for and becomes a
   * catalogue price. Counting it here rather than on screen 06 is task 2.6's
   * own instruction and the reason is LAW 1's: the stepper is a function of
   * facts, and a fact the page fetches for itself is a fact the deal list
   * cannot see.
   */
  const quotes = await db
    .select({ dealId: priceQuote.dealId, n: sql<number>`count(*)::int` })
    .from(priceQuote)
    .where(inArray(sql`${priceQuote.dealId}`, dealIds))
    .groupBy(priceQuote.dealId);

  for (const row of quotes) {
    const facts = row.dealId ? out.get(row.dealId) : undefined;
    if (facts) facts.priceQuotes = row.n;
  }

  const asked = await db
    .select({
      dealId: sourcingRequest.dealId,
      suppliers: sql<number>`count(distinct ${sourcingResponse.partyId})::int`,
    })
    .from(sourcingRequest)
    .innerJoin(sourcingResponse, eq(sourcingResponse.requestId, sourcingRequest.id))
    .where(
      and(
        inArray(sourcingRequest.dealId, dealIds),
        // Sent, not drafted. See the note above.
        sql`${sourcingRequest.sentAt} is not null`,
      ),
    )
    .groupBy(sourcingRequest.dealId);

  for (const row of asked) {
    const facts = out.get(row.dealId);
    if (facts) facts.suppliersAsked = row.suppliers;
  }

  return out;
}

export type DealRow = {
  id: string;
  ref: string;
  clientName: string;
  subject: string;
  clientReference: string | null;
  expectedValue: string | null;
  currency: string;
  ownerId: string | null;
  facts: DealFacts;
  stage: Stage;
  // Not `string`. It was, and that let the screens build a message key out of
  // it by hand for values that have no key under that prefix - a 500 on the
  // deal page for every won, lost or no-bid enquiry. Use badgeMessageKey.
  badge: Stage | Outcome;
  open: boolean;
  deadline: ReturnType<typeof deadlineDisplay>;
};

/**
 * Screen 05's list.
 *
 * Filtering by stage happens in JavaScript, after the counts come back, and
 * that is not laziness — the stage is a function of four counts and two
 * columns, so expressing it as SQL means writing `stageOf` a second time in a
 * language where it cannot be tested. Two implementations of one rule is how a
 * chip labelled "Sourcing 9" comes to show eight rows.
 *
 * The cost is that paging has to happen after the filter. At this company's
 * volume — a few hundred enquiries a year — that is free. If it ever stops
 * being free, the fix is a materialised view refreshed from the same function,
 * not a second copy of the logic.
 */
export async function listDeals(
  opts: { stage?: Stage; openOnly?: boolean; limit?: number } = {},
): Promise<{ rows: DealRow[]; total: number; counts: Record<string, number> }> {
  const base = await db
    .select({
      id: deal.id,
      ref: deal.ref,
      subject: deal.subject,
      clientReference: deal.clientReference,
      expectedValue: deal.expectedValue,
      currency: deal.currency,
      ownerId: deal.ownerId,
      decision: deal.decision,
      lostAt: deal.lostAt,
      deadlineAt: deal.deadlineAt,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      lineCount: sql<number>`(select count(*)::int from ${dealLine} where ${dealLine.dealId} = ${deal.id})`,
    })
    .from(deal)
    .innerJoin(party, eq(party.id, deal.partyId))
    .where(isNull(deal.deletedAt))
    .orderBy(desc(deal.receivedAt));

  const counted = await factsFor(base.map((r) => r.id));
  const now = new Date();

  const all: DealRow[] = base.map((row) => {
    const facts: DealFacts = {
      decision: (row.decision as DealFacts["decision"]) ?? null,
      lostAt: row.lostAt,
      lineCount: row.lineCount,
      ...(counted.get(row.id) ?? NO_COUNTS),
    };
    return {
      id: row.id,
      ref: row.ref,
      clientName: row.clientName,
      subject: row.subject,
      clientReference: row.clientReference,
      expectedValue: row.expectedValue,
      currency: row.currency,
      ownerId: row.ownerId,
      facts,
      stage: stageOf(facts),
      badge: badgeOf(facts),
      open: isOpen(facts),
      deadline: deadlineDisplay(facts, row.deadlineAt, now),
    };
  });

  // The chip counts are over everything, not over the current filter — a chip
  // that changes its own number when you press it is a chip nobody trusts.
  const counts: Record<string, number> = { all: all.length };
  for (const row of all) counts[row.stage] = (counts[row.stage] ?? 0) + 1;

  let rows = all;
  if (opts.openOnly) rows = rows.filter((r) => r.open);
  if (opts.stage) rows = rows.filter((r) => r.stage === opts.stage);

  return {
    rows: opts.limit ? rows.slice(0, opts.limit) : rows,
    total: rows.length,
    counts,
  };
}

export class DecisionRefused extends Error {
  constructor(
    readonly reason: "noSuchDeal" | "reasonRequired" | "unknownReason" | "alreadyClosed",
  ) {
    super(reason);
  }
}

/**
 * Screen 06's go/no-go card.
 *
 * A no-bid needs a reason and the database will not accept one without (see
 * migration 0015). This checks first anyway, because a constraint violation
 * reaches the person as a five-hundred and a refusal reaches them as a sentence
 * next to the field.
 *
 * Changing your mind is allowed — pursue after a no-bid, and the audit trail
 * holds both. What is NOT allowed is deciding on an enquiry that is already
 * closed: a no-bid on something we won six weeks ago is a mis-click, and
 * accepting it would silently rewrite the pipeline.
 */
export async function decide(opts: {
  dealId: string;
  decision: "pursue" | "no_bid";
  reason?: NoBidReason | null;
  note?: string | null;
  expectedValue?: string | null;
  actorId: string;
}): Promise<void> {
  const [row] = await db
    .select({
      decision: deal.decision,
      lostAt: deal.lostAt,
      lineCount: sql<number>`(select count(*)::int from ${dealLine} where ${dealLine.dealId} = ${deal.id})`,
    })
    .from(deal)
    .where(and(eq(deal.id, opts.dealId), isNull(deal.deletedAt)))
    .limit(1);
  if (!row) throw new DecisionRefused("noSuchDeal");

  const counted = (await factsFor([opts.dealId])).get(opts.dealId);
  const facts: DealFacts = {
    decision: (row.decision as DealFacts["decision"]) ?? null,
    lostAt: row.lostAt,
    lineCount: row.lineCount,
    ...(counted ?? NO_COUNTS),
  };
  // A no-bid already recorded is not "closed" for this purpose — reversing your
  // own no-bid is the case this whole card exists to make cheap.
  if (facts.lostAt || facts.ordersReceived > 0) throw new DecisionRefused("alreadyClosed");

  if (opts.decision === "no_bid") {
    if (!opts.reason) throw new DecisionRefused("reasonRequired");
    if (!NO_BID_REASONS.includes(opts.reason)) throw new DecisionRefused("unknownReason");
  }

  const reason =
    opts.decision === "no_bid"
      ? [opts.reason, opts.note?.trim()].filter(Boolean).join(" — ")
      : (opts.note?.trim() ?? null);

  await db
    .update(deal)
    .set({
      decision: opts.decision,
      decisionReason: reason || null,
      decidedAt: new Date(),
      decidedBy: opts.actorId,
      ...(opts.expectedValue !== undefined ? { expectedValue: opts.expectedValue } : {}),
    })
    .where(eq(deal.id, opts.dealId));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "deal",
    entityId: opts.dealId,
    action: "update",
    before: { decision: row.decision },
    after: { decision: opts.decision, reason },
    sourceScreen: "06",
  });
}

/**
 * "They went with someone else."
 *
 * The only fact in this whole module that no document will ever contain. It is
 * stored because it is unknowable, and it is reversible because it arrives by
 * telephone and telephones mishear.
 */
export async function recordLost(opts: {
  dealId: string;
  reason: string;
  actorId: string;
}): Promise<void> {
  const reason = opts.reason.trim();
  if (!reason) throw new DecisionRefused("reasonRequired");

  const [row] = await db
    .select({ lostAt: deal.lostAt })
    .from(deal)
    .where(and(eq(deal.id, opts.dealId), isNull(deal.deletedAt)))
    .limit(1);
  if (!row) throw new DecisionRefused("noSuchDeal");

  await db
    .update(deal)
    .set({ lostAt: new Date(), lostReason: reason })
    .where(eq(deal.id, opts.dealId));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "deal",
    entityId: opts.dealId,
    action: "update",
    after: { lost: true, reason },
    sourceScreen: "06",
  });
}

/** Undo. The client rang back; it was a different enquiry. */
export async function reopen(opts: { dealId: string; actorId: string }): Promise<void> {
  await db.update(deal).set({ lostAt: null, lostReason: null }).where(eq(deal.id, opts.dealId));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "deal",
    entityId: opts.dealId,
    action: "update",
    after: { lost: false },
    sourceScreen: "06",
  });
}

/** Screen 06, whole. One deal, its lines, and the facts behind its badge. */
export async function getDeal(id: string) {
  const [row] = await db
    .select({
      deal,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      clientCode: party.code,
      docLocale: party.docLocale,
    })
    .from(deal)
    .innerJoin(party, eq(party.id, deal.partyId))
    .where(and(eq(deal.id, id), isNull(deal.deletedAt)))
    .limit(1);
  if (!row) return null;

  const lines = await db
    .select()
    .from(dealLine)
    .where(eq(dealLine.dealId, id))
    .orderBy(dealLine.position);

  const counted = (await factsFor([id])).get(id);
  const facts: DealFacts = {
    decision: (row.deal.decision as DealFacts["decision"]) ?? null,
    lostAt: row.deal.lostAt,
    lineCount: lines.length,
    ...(counted ?? NO_COUNTS),
  };

  return {
    ...row,
    lines,
    facts,
    stage: stageOf(facts),
    badge: badgeOf(facts),
    open: isOpen(facts),
    deadline: deadlineDisplay(facts, row.deal.deadlineAt, new Date()),
  };
}
