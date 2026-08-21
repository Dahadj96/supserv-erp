import { and, asc, desc, eq, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { intakeMessage, routingRule } from "@/db/schema/intake";
import { party } from "@/db/schema/party";
import type { RoutedTo } from "./routing";

/**
 * Screen 02 — the Inbox.
 *
 * "none of the twelve expire unread" is the phase-2 acceptance test in
 * docs/PLAN.md, and this file is where it is made possible: everything that
 * arrived, sorted so the thing with a deadline is at the top, and nothing ever
 * silently leaves.
 */

/** The chips across the top, in the order screen 02 draws them. */
export const INBOX_FACETS = [
  "all",
  "enquiry",
  "tender",
  "candidate",
  "payment",
  "supplierQuote",
  "needsReview",
] as const;
export type InboxFacet = (typeof INBOX_FACETS)[number];

export function isInboxFacet(value: string | undefined): value is InboxFacet {
  return INBOX_FACETS.includes(value as InboxFacet);
}

/**
 * Screen 02 also draws an "Admin" chip — an email that is neither a deal nor a
 * document, whose action is "Create task". Tasks arrive in phase 6, and a chip
 * that can only ever read 0 teaches people to stop reading the chips. It is
 * absent until there is something behind it.
 */

/** Inside this, the row is red and the banner names it. */
export const DEADLINE_WARNING_HOURS = 48;

export type InboxRow = {
  id: string;
  channelKey: string;
  receivedAt: Date;
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  classifiedAs: RoutedTo | null;
  confidence: number | null;
  /** True when the router wanted to act and the confidence floor stopped it. */
  downgraded: boolean;
  partyId: string | null;
  partyName: string | null;
  deadlineAt: Date | null;
  deadlineConfirmed: boolean;
  hoursLeft: number | null;
  read: boolean;
  status: string;
};

/** Not dismissed, not committed. What is actually waiting for somebody. */
const open = and(ne(intakeMessage.status, "dismissed"), isNull(intakeMessage.committedAt));

export async function listInbox(
  facet: InboxFacet = "all",
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<InboxRow[]> {
  const conditions = [open];
  if (facet !== "all") conditions.push(eq(intakeMessage.classifiedAs, facet));
  if (opts.unreadOnly) conditions.push(isNull(intakeMessage.readAt));

  const rows = await db
    .select({
      id: intakeMessage.id,
      channelKey: intakeMessage.channelKey,
      receivedAt: intakeMessage.receivedAt,
      fromName: intakeMessage.fromName,
      fromAddress: intakeMessage.fromAddress,
      subject: intakeMessage.subject,
      classifiedAs: intakeMessage.classifiedAs,
      confidence: intakeMessage.confidence,
      raw: intakeMessage.raw,
      partyId: intakeMessage.partyId,
      partyName: party.legalName,
      deadlineAt: intakeMessage.deadlineAt,
      deadlineConfirmedAt: intakeMessage.deadlineConfirmedAt,
      readAt: intakeMessage.readAt,
      status: intakeMessage.status,
    })
    .from(intakeMessage)
    .leftJoin(party, eq(intakeMessage.partyId, party.id))
    .where(and(...conditions))
    // A deadline outranks everything. Postgres sorts nulls last by default on
    // ASC, which is exactly right here: dated things first, then by arrival.
    .orderBy(asc(intakeMessage.deadlineAt), desc(intakeMessage.receivedAt))
    .limit(opts.limit ?? 200);

  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    channelKey: r.channelKey,
    receivedAt: r.receivedAt,
    fromName: r.fromName,
    fromAddress: r.fromAddress,
    subject: r.subject,
    classifiedAs: (r.classifiedAs as RoutedTo | null) ?? null,
    confidence: r.confidence === null ? null : Number(r.confidence),
    downgraded: (r.raw as { downgraded?: boolean } | null)?.downgraded === true,
    partyId: r.partyId,
    partyName: r.partyName,
    deadlineAt: r.deadlineAt,
    deadlineConfirmed: r.deadlineConfirmedAt !== null,
    hoursLeft: r.deadlineAt ? Math.round((r.deadlineAt.getTime() - now) / 3_600_000) : null,
    read: r.readAt !== null,
    status: r.status,
  }));
}

export type InboxCounts = Record<InboxFacet, number> & { unread: number; expiringSoon: number };

export async function inboxCounts(): Promise<InboxCounts> {
  const soon = new Date(Date.now() + DEADLINE_WARNING_HOURS * 3_600_000);

  const rows = await db
    .select({
      classifiedAs: intakeMessage.classifiedAs,
      n: sql<number>`count(*)::int`,
      unread: sql<number>`count(*) filter (where ${intakeMessage.readAt} is null)::int`,
      soon: sql<number>`count(*) filter (
        where ${intakeMessage.deadlineAt} is not null
          and ${intakeMessage.deadlineAt} <= ${soon.toISOString()}
      )::int`,
    })
    .from(intakeMessage)
    .where(open)
    .groupBy(intakeMessage.classifiedAs);

  const counts = {
    all: 0,
    enquiry: 0,
    tender: 0,
    candidate: 0,
    payment: 0,
    supplierQuote: 0,
    needsReview: 0,
    unread: 0,
    expiringSoon: 0,
  } as InboxCounts;

  for (const row of rows) {
    counts.all += row.n;
    counts.unread += row.unread;
    counts.expiringSoon += row.soon;
    const key = row.classifiedAs as InboxFacet | null;
    if (key && key in counts) counts[key] += row.n;
  }
  return counts;
}

/** The named items in the red banner. Two of them, by name, not a number. */
export async function expiringSoon(limit = 3) {
  const soon = new Date(Date.now() + DEADLINE_WARNING_HOURS * 3_600_000);
  const rows = await db
    .select({
      id: intakeMessage.id,
      subject: intakeMessage.subject,
      partyName: party.legalName,
      deadlineAt: intakeMessage.deadlineAt,
    })
    .from(intakeMessage)
    .leftJoin(party, eq(intakeMessage.partyId, party.id))
    .where(and(open, isNotNull(intakeMessage.deadlineAt), lte(intakeMessage.deadlineAt, soon)))
    .orderBy(asc(intakeMessage.deadlineAt))
    .limit(limit);

  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    hoursLeft: r.deadlineAt ? Math.round((r.deadlineAt.getTime() - now) / 3_600_000) : 0,
  }));
}

/**
 * Screen 02's bottom card — "Not classified with confidence — needs a human".
 *
 * Two kinds land here: what the router could not place at all, and what it
 * wanted to act on but was not sure enough about. The second kind is the more
 * interesting one, because it is the confidence floor doing its job in public.
 */
export async function needsAHuman(limit = 10) {
  const rows = await db
    .select({
      id: intakeMessage.id,
      fromAddress: intakeMessage.fromAddress,
      fromName: intakeMessage.fromName,
      subject: intakeMessage.subject,
      classifiedAs: intakeMessage.classifiedAs,
      confidence: intakeMessage.confidence,
      raw: intakeMessage.raw,
      partyId: intakeMessage.partyId,
      partyName: party.legalName,
      ruleLabel: routingRule.labelKey,
    })
    .from(intakeMessage)
    .leftJoin(party, eq(intakeMessage.partyId, party.id))
    .leftJoin(routingRule, eq(intakeMessage.matchedRuleId, routingRule.id))
    .where(
      and(
        open,
        sql`(${intakeMessage.classifiedAs} = 'needsReview'
             or (${intakeMessage.raw} ->> 'downgraded')::boolean is true)`,
      ),
    )
    .orderBy(desc(intakeMessage.receivedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    fromAddress: r.fromAddress,
    fromName: r.fromName,
    subject: r.subject,
    classifiedAs: r.classifiedAs as RoutedTo | null,
    confidence: r.confidence === null ? null : Number(r.confidence),
    downgraded: (r.raw as { downgraded?: boolean } | null)?.downgraded === true,
    partyId: r.partyId,
    partyName: r.partyName,
    ruleLabel: r.ruleLabel,
  }));
}

export async function markRead(id: string) {
  await db
    .update(intakeMessage)
    .set({ readAt: new Date() })
    .where(and(eq(intakeMessage.id, id), isNull(intakeMessage.readAt)));
}

/**
 * Dismiss is not delete (screen 83).
 *
 * The row leaves the inbox and stays in the table, findable, with a reason and
 * an audit entry. An email nobody can find again is worse than one nobody read.
 */
export async function dismiss(id: string, actorId: string, reason?: string) {
  await db.update(intakeMessage).set({ status: "dismissed" }).where(eq(intakeMessage.id, id));

  await db.insert(auditEntry).values({
    actorId,
    actorKind: "user",
    entity: "intake_message",
    entityId: id,
    action: "dismiss",
    reason: reason ?? null,
    sourceScreen: "02",
  });
}

export async function undismiss(id: string, actorId: string) {
  await db.update(intakeMessage).set({ status: "needs_review" }).where(eq(intakeMessage.id, id));

  await db.insert(auditEntry).values({
    actorId,
    actorKind: "user",
    entity: "intake_message",
    entityId: id,
    action: "undismiss",
    sourceScreen: "02",
  });
}

/** A person overruling the router. What they said is a fact; what it said was not. */
export async function reclassify(id: string, to: RoutedTo, actorId: string) {
  const [before] = await db
    .select({ classifiedAs: intakeMessage.classifiedAs })
    .from(intakeMessage)
    .where(eq(intakeMessage.id, id))
    .limit(1);

  await db
    .update(intakeMessage)
    .set({
      classifiedAs: to,
      // A person is certain by definition. The floor exists to stop the
      // machine acting alone, not to doubt somebody who read the email.
      confidence: "1.000",
      status: "classified",
    })
    .where(eq(intakeMessage.id, id));

  await db.insert(auditEntry).values({
    actorId,
    actorKind: "user",
    entity: "intake_message",
    entityId: id,
    action: "reclassify",
    before: { classifiedAs: before?.classifiedAs ?? null },
    after: { classifiedAs: to },
    sourceScreen: "02",
  });
}
