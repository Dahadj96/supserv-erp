import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine } from "@/db/schema/deal";
import { party } from "@/db/schema/party";
import { sourcingLine, sourcingRequest, sourcingResponse } from "@/db/schema/sourcing";
import {
  type ClientRequires,
  RESPONSE_STATUSES,
  type ResponseStatus,
  type SupplierAnswer,
} from "./sourcing";

/**
 * Screens 09, 10 and 67 — the database half.
 *
 * `sourcing.ts` stays pure: the conflict checks and the split arithmetic are
 * the valuable part and they are testable precisely because they touch nothing.
 */

export class SourcingRefused extends Error {
  constructor(
    readonly reason:
      | "noSuchRequest"
      | "noSuchDeal"
      | "closed"
      | "alreadySent"
      | "noSuppliers"
      | "unknownStatus"
      | "notQuoted",
  ) {
    super(reason);
  }
}

/** SR-2026-0018. Same reasoning as `nextDealRef` — internal handle, not LAW 5. */
export async function nextRequestRef(tx: typeof db, when: Date): Promise<string> {
  const prefix = `SR-${when.getFullYear()}-`;
  const [row] = await tx
    .select({ last: sql<string | null>`max(${sourcingRequest.ref})` })
    .from(sourcingRequest)
    .where(
      sql`${sourcingRequest.ref} like ${`${prefix}%`} and ${sourcingRequest.ref} ~ ${`^${prefix}[0-9]+$`}`,
    );

  const lastNumber = row?.last ? Number(row.last.slice(prefix.length)) : 0;
  return `${prefix}${String(lastNumber + 1).padStart(4, "0")}`;
}

/**
 * Ask a set of suppliers about an enquiry.
 *
 * Creates the request DRAFTED — `sentAt` stays null until `markSent`. That
 * split is what lets screen 05's derived stage tell "somebody is thinking about
 * sourcing" from "four suppliers have been asked and two have not replied".
 */
export async function createRequest(opts: {
  dealId: string;
  subject: string;
  supplierIds: string[];
  excludedLineIds?: string[];
  replyBy?: Date | null;
  actorId: string;
}): Promise<string> {
  if (opts.supplierIds.length === 0) throw new SourcingRefused("noSuppliers");

  const [row] = await db
    .select({ lostAt: deal.lostAt })
    .from(deal)
    .where(and(eq(deal.id, opts.dealId), sql`${deal.deletedAt} is null`))
    .limit(1);
  if (!row) throw new SourcingRefused("noSuchDeal");
  if (row.lostAt) throw new SourcingRefused("closed");

  return db.transaction(async (tx) => {
    const ref = await nextRequestRef(tx as unknown as typeof db, new Date());

    const [created] = await tx
      .insert(sourcingRequest)
      .values({
        ref,
        dealId: opts.dealId,
        subject: opts.subject.trim() || ref,
        excludedLineIds: opts.excludedLineIds ?? [],
        replyBy: opts.replyBy ?? null,
        createdBy: opts.actorId,
      })
      .returning({ id: sourcingRequest.id });

    const id = created?.id as string;

    // Deduplicated: asking one supplier twice on one request is a unique-index
    // violation, and a person clicking a name twice should not see one.
    const unique = [...new Set(opts.supplierIds)];
    await tx.insert(sourcingResponse).values(unique.map((partyId) => ({ requestId: id, partyId })));

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "sourcing_request",
      entityId: id,
      action: "create",
      after: { ref, dealId: opts.dealId, suppliers: unique.length, sent: false },
      sourceScreen: "10",
    });

    return id;
  });
}

/**
 * The messages went out.
 *
 * Sending them is somebody's job, not this function's — LAW 6 and the safety
 * rail `NEVER_AUTO_REPLY`. This records that they were sent, which is what the
 * derived stage counts and what the reply-by clock hangs off.
 */
export async function markSent(opts: {
  requestId: string;
  actorId: string;
  when?: Date;
}): Promise<void> {
  const [row] = await db
    .select({ sentAt: sourcingRequest.sentAt })
    .from(sourcingRequest)
    .where(eq(sourcingRequest.id, opts.requestId))
    .limit(1);
  if (!row) throw new SourcingRefused("noSuchRequest");
  if (row.sentAt) throw new SourcingRefused("alreadySent");

  await db
    .update(sourcingRequest)
    .set({ sentAt: opts.when ?? new Date() })
    .where(eq(sourcingRequest.id, opts.requestId));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "sourcing_request",
    entityId: opts.requestId,
    action: "update",
    after: { sent: true },
    sourceScreen: "10",
  });
}

/**
 * Record what a supplier said.
 *
 * The status drives everything downstream, so it is validated here rather than
 * trusted — and `bounced` is accepted as a first-class answer. It is not a
 * failure to record; it is the most actionable thing on the screen, because it
 * means the address is wrong and no amount of chasing will fix it.
 */
export async function recordAnswer(opts: {
  responseId: string;
  status: string;
  validityDays?: number | null;
  leadTimeDays?: number | null;
  currency?: string;
  isExclVat?: boolean;
  note?: string | null;
  /** dealLineId → unit price. Only read when the status is `quoted`. */
  prices?: Record<string, string>;
  actorId: string;
}): Promise<void> {
  if (!RESPONSE_STATUSES.includes(opts.status as ResponseStatus)) {
    throw new SourcingRefused("unknownStatus");
  }
  const status = opts.status as ResponseStatus;

  const [row] = await db
    .select({ id: sourcingResponse.id, requestId: sourcingResponse.requestId })
    .from(sourcingResponse)
    .where(eq(sourcingResponse.id, opts.responseId))
    .limit(1);
  if (!row) throw new SourcingRefused("noSuchRequest");

  await db.transaction(async (tx) => {
    await tx
      .update(sourcingResponse)
      .set({
        status,
        receivedAt: status === "asked" ? null : new Date(),
        // Terms belong to a quote and nothing else. The check constraint in
        // migration 0018 says the same thing; this keeps a person from meeting
        // it as a five-hundred.
        validityDays: status === "quoted" ? (opts.validityDays ?? null) : null,
        leadTimeDays: status === "quoted" ? (opts.leadTimeDays ?? null) : null,
        currency: opts.currency || "DZD",
        isExclVat: opts.isExclVat ?? true,
        note: opts.note?.trim() || null,
      })
      .where(eq(sourcingResponse.id, opts.responseId));

    // Replace, never merge — the same reasoning as `replaceLines`. What is on
    // the screen is what the person read off the supplier's email.
    await tx.delete(sourcingLine).where(eq(sourcingLine.responseId, opts.responseId));

    if (status === "quoted" && opts.prices) {
      const rows = Object.entries(opts.prices)
        .filter(([, price]) => price.trim() !== "")
        .map(([dealLineId, price]) => ({
          responseId: opts.responseId,
          dealLineId,
          unitPrice: price.trim().replace(/[\s ]/g, "").replace(",", "."),
        }));
      if (rows.length > 0) await tx.insert(sourcingLine).values(rows);
    }

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "sourcing_response",
      entityId: opts.responseId,
      action: "update",
      after: {
        status,
        validityDays: status === "quoted" ? (opts.validityDays ?? null) : null,
        leadTimeDays: status === "quoted" ? (opts.leadTimeDays ?? null) : null,
        linesPriced: status === "quoted" ? Object.keys(opts.prices ?? {}).length : 0,
      },
      sourceScreen: "67",
    });
  });
}

/** Screen 67's "Chase 2". Records that we chased; sending is a person's job. */
export async function recordChase(opts: {
  responseIds: string[];
  actorId: string;
}): Promise<number> {
  if (opts.responseIds.length === 0) return 0;

  await db
    .update(sourcingResponse)
    .set({
      chasedCount: sql`${sourcingResponse.chasedCount} + 1`,
      lastChasedAt: new Date(),
    })
    .where(inArray(sourcingResponse.id, opts.responseIds));

  for (const id of opts.responseIds) {
    await db.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "sourcing_response",
      entityId: id,
      action: "update",
      after: { chased: true },
      sourceScreen: "67",
    });
  }

  return opts.responseIds.length;
}

/** Everything screen 67 needs about one request, in the shape the pure module wants. */
export async function requestFor(requestId: string) {
  const [row] = await db
    .select({
      request: sourcingRequest,
      dealRef: deal.ref,
      dealId: deal.id,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      deadlineAt: deal.deadlineAt,
      currency: deal.currency,
      requiredValidityDays: deal.requiredValidityDays,
      requiredDeliveryDays: deal.requiredDeliveryDays,
      latePenalty: deal.latePenalty,
    })
    .from(sourcingRequest)
    .innerJoin(deal, eq(deal.id, sourcingRequest.dealId))
    .innerJoin(party, eq(party.id, deal.partyId))
    .where(eq(sourcingRequest.id, requestId))
    .limit(1);
  if (!row) return null;

  const excluded = new Set((row.request.excludedLineIds as string[] | null) ?? []);
  const allLines = await db
    .select()
    .from(dealLine)
    .where(eq(dealLine.dealId, row.dealId))
    .orderBy(dealLine.position);
  const lines = allLines.filter((l) => !excluded.has(l.id));

  const responses = await db
    .select({
      id: sourcingResponse.id,
      partyId: sourcingResponse.partyId,
      status: sourcingResponse.status,
      receivedAt: sourcingResponse.receivedAt,
      validityDays: sourcingResponse.validityDays,
      leadTimeDays: sourcingResponse.leadTimeDays,
      currency: sourcingResponse.currency,
      note: sourcingResponse.note,
      chasedCount: sourcingResponse.chasedCount,
      legalName: party.legalName,
      tradeName: party.tradeName,
    })
    .from(sourcingResponse)
    .innerJoin(party, eq(party.id, sourcingResponse.partyId))
    .where(eq(sourcingResponse.requestId, requestId));

  const quoted = await db
    .select()
    .from(sourcingLine)
    .where(
      inArray(
        sourcingLine.responseId,
        responses.map((r) => r.id),
      ),
    );

  const answers: SupplierAnswer[] = responses.map((response) => {
    const prices = new Map<string, string>();
    for (const line of quoted) {
      if (line.responseId !== response.id || line.unitPrice === null) continue;
      prices.set(line.dealLineId, line.unitPrice);
    }
    return {
      responseId: response.id,
      partyId: response.partyId,
      supplierName: response.tradeName?.trim() || response.legalName,
      status: response.status as ResponseStatus,
      validityDays: response.validityDays,
      leadTimeDays: response.leadTimeDays,
      currency: response.currency,
      prices,
    };
  });

  const requires: ClientRequires = {
    validityDays: row.requiredValidityDays,
    deliveryDays: row.requiredDeliveryDays,
    latePenalty: row.latePenalty,
    currency: row.currency,
    deadlineAt: row.deadlineAt,
  };

  const quotedOn = new Map(responses.map((r) => [r.id, r.receivedAt] as const));

  return {
    ...row,
    lines,
    excludedCount: allLines.length - lines.length,
    responses,
    answers,
    requires,
    quotedOn,
  };
}

/**
 * Screen 09 — every request on one enquiry.
 *
 * A join and a group-by rather than two correlated subqueries. The subquery
 * form read more directly and returned zero for every row: drizzle renders a
 * `sql` template's table reference in a way that does not correlate back to the
 * outer query, so both counts silently counted nothing. Silently is the problem
 * — a count of zero looks like "nobody was asked", which is a sentence this
 * screen exists to say truthfully.
 */
export async function requestsForDeal(dealId: string) {
  return db
    .select({
      id: sourcingRequest.id,
      ref: sourcingRequest.ref,
      subject: sourcingRequest.subject,
      sentAt: sourcingRequest.sentAt,
      replyBy: sourcingRequest.replyBy,
      asked: sql<number>`count(${sourcingResponse.id})::int`,
      quoted: sql<number>`count(*) filter (where ${sourcingResponse.status} = 'quoted')::int`,
    })
    .from(sourcingRequest)
    .leftJoin(sourcingResponse, eq(sourcingResponse.requestId, sourcingRequest.id))
    .where(eq(sourcingRequest.dealId, dealId))
    .groupBy(
      sourcingRequest.id,
      sourcingRequest.ref,
      sourcingRequest.subject,
      sourcingRequest.sentAt,
      sourcingRequest.replyBy,
      sourcingRequest.createdAt,
    )
    .orderBy(sourcingRequest.createdAt);
}
