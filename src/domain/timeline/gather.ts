import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal } from "@/db/schema/deal";
import { document } from "@/db/schema/document";
import { intakeMessage } from "@/db/schema/intake";
import { note } from "@/db/schema/note";
import { party } from "@/db/schema/party";
import { sourcingRequest, sourcingResponse } from "@/db/schema/sourcing";
import type { TimelineEvent } from "./events";

/**
 * Screen 56 — where "everything that happened" comes from.
 *
 * Six sources, none of them an event table: the messages that arrived, the
 * sourcing requests that went out and the answers that came back, the documents
 * that were issued, the notes and calls somebody typed, and the audit log for
 * the things the software did on its own.
 *
 * A seventh source would be an `event` table holding a copy of each. It would
 * be far less code here and a much worse system: two versions of every fact,
 * and no way to tell which one happened on the day they disagree.
 */

/** Messages that arrived against this deal. */
async function messages(dealId: string): Promise<TimelineEvent[]> {
  const rows = await db
    .select({
      id: intakeMessage.id,
      subject: intakeMessage.subject,
      body: intakeMessage.bodyText,
      fromName: intakeMessage.fromName,
      fromAddress: intakeMessage.fromAddress,
      receivedAt: intakeMessage.receivedAt,
    })
    .from(intakeMessage)
    .where(
      and(eq(intakeMessage.committedEntity, "deal"), eq(intakeMessage.committedEntityId, dealId)),
    );

  return rows.map((row) => ({
    id: `msg:${row.id}`,
    side: "in" as const,
    what: "messageArrived",
    title: row.subject ?? row.fromName ?? row.fromAddress ?? "—",
    // Verbatim, trimmed to a readable length rather than summarised. A summary
    // of what a client wrote is somebody's reading of it, not what they said.
    body: row.body ? row.body.slice(0, 400) : null,
    actor: row.fromName ?? row.fromAddress,
    at: row.receivedAt,
    href: "/inbox",
    chips: [],
  }));
}

/** Prices asked for, and prices that came back. */
async function sourcing(dealId: string): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];

  const asked = await db
    .select({
      id: sourcingRequest.id,
      ref: sourcingRequest.ref,
      subject: sourcingRequest.subject,
      sentAt: sourcingRequest.sentAt,
      suppliers: sql<number>`(
        select count(*) from sourcing_response sr where sr.request_id = ${sourcingRequest.id}
      )::int`,
    })
    .from(sourcingRequest)
    .where(and(eq(sourcingRequest.dealId, dealId), sql`${sourcingRequest.sentAt} is not null`));

  for (const row of asked) {
    events.push({
      id: `sr:${row.id}`,
      side: "out",
      what: "askedSuppliers",
      title: row.subject,
      body: null,
      actor: null,
      at: row.sentAt as Date,
      href: `/sourcing/${row.id}`,
      chips: [row.ref, String(row.suppliers)],
    });
  }

  const answers = await db
    .select({
      id: sourcingResponse.id,
      requestId: sourcingResponse.requestId,
      receivedAt: sourcingResponse.receivedAt,
      status: sourcingResponse.status,
      supplier: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      priced: sql<number>`(
        select count(*) from sourcing_line sl where sl.response_id = ${sourcingResponse.id}
      )::int`,
    })
    .from(sourcingResponse)
    .innerJoin(sourcingRequest, eq(sourcingRequest.id, sourcingResponse.requestId))
    .innerJoin(party, eq(party.id, sourcingResponse.partyId))
    .where(
      and(eq(sourcingRequest.dealId, dealId), sql`${sourcingResponse.receivedAt} is not null`),
    );

  for (const row of answers) {
    events.push({
      id: `sresp:${row.id}`,
      side: "in",
      what: "quoteReceived",
      title: row.supplier,
      body: null,
      actor: row.supplier,
      at: row.receivedAt as Date,
      href: `/sourcing/${row.requestId}`,
      chips: [String(row.priced)],
    });
  }

  return events;
}

/** Documents raised against the deal. Issued ones only carry a date. */
async function documents(dealId: string): Promise<TimelineEvent[]> {
  const rows = await db
    .select({
      id: document.id,
      kind: document.kind,
      number: document.number,
      issuedOn: document.issuedOn,
      createdAt: document.createdAt,
    })
    .from(document)
    .where(eq(document.dealId, dealId));

  return rows.map((row) => ({
    id: `doc:${row.id}`,
    side: row.number ? ("out" as const) : ("system" as const),
    // A draft is not a thing that left the building. LAW 5 again: the number
    // IS the issue, so a numbered document went out and an unnumbered one was
    // merely created.
    what: row.number ? "documentIssued" : "draftCreated",
    title: row.number ?? row.kind,
    body: null,
    actor: null,
    at: row.issuedOn ? new Date(`${row.issuedOn}T00:00:00Z`) : row.createdAt,
    href: `/documents/${row.id}`,
    chips: [row.kind],
  }));
}

/** What a person typed. The only rows here that exist nowhere else. */
async function notes(entity: string, entityId: string): Promise<TimelineEvent[]> {
  const rows = await db
    .select()
    .from(note)
    .where(and(eq(note.entity, entity), eq(note.entityId, entityId), isNull(note.deletedAt)))
    .orderBy(desc(note.happenedAt));

  return rows.map((row) => ({
    id: `note:${row.id}`,
    side: "noted" as const,
    what: row.kind,
    title: row.body.split("\n")[0]?.slice(0, 120) ?? "",
    body: row.body,
    actor: row.authorId,
    // When it HAPPENED, not when it was typed.
    at: row.happenedAt,
    href: null,
    chips: row.dueAt ? [row.dueAt] : [],
  }));
}

/** What the software did on its own. */
async function systemEvents(dealId: string): Promise<TimelineEvent[]> {
  const rows = await db
    .select({
      id: auditEntry.id,
      entity: auditEntry.entity,
      action: auditEntry.action,
      at: auditEntry.at,
      actorKind: auditEntry.actorKind,
      screen: auditEntry.sourceScreen,
    })
    .from(auditEntry)
    .where(and(eq(auditEntry.entity, "deal"), eq(auditEntry.entityId, dealId)))
    .orderBy(asc(auditEntry.at));

  return rows.map((row) => ({
    id: `audit:${row.id}`,
    side: row.actorKind === "user" ? ("noted" as const) : ("system" as const),
    what: `${row.entity}.${row.action}`,
    title: row.action,
    body: null,
    actor: null,
    at: row.at,
    href: null,
    chips: row.screen ? [row.screen] : [],
  }));
}

/** Everything that happened to one deal. */
export async function timelineFor(dealId: string): Promise<TimelineEvent[]> {
  const [a, b, c, d, e] = await Promise.all([
    messages(dealId),
    sourcing(dealId),
    documents(dealId),
    notes("deal", dealId),
    systemEvents(dealId),
  ]);
  return [...a, ...b, ...c, ...d, ...e];
}

export class NoteRefused extends Error {
  constructor(readonly why: "empty" | "noSuchDeal") {
    super(why);
  }
}

/** Write down something the system did not see. */
export async function addNote(opts: {
  entity: string;
  entityId: string;
  kind: string;
  body: string;
  /** When it happened, if that is not now. */
  happenedAt?: Date;
  dueAt?: string | null;
  actorId: string;
}): Promise<string> {
  // The database refuses this too. Checked here so a person meets a sentence
  // rather than a five-hundred.
  if (!opts.body.trim()) throw new NoteRefused("empty");

  if (opts.entity === "deal") {
    const [exists] = await db
      .select({ id: deal.id })
      .from(deal)
      .where(eq(deal.id, opts.entityId))
      .limit(1);
    if (!exists) throw new NoteRefused("noSuchDeal");
  }

  const [created] = await db
    .insert(note)
    .values({
      entity: opts.entity,
      entityId: opts.entityId,
      kind: opts.kind,
      // Verbatim. A tidied note is somebody's later summary of what was said.
      body: opts.body.trim(),
      happenedAt: opts.happenedAt ?? new Date(),
      dueAt: opts.dueAt || null,
      authorId: opts.actorId,
    })
    .returning({ id: note.id });

  const id = created?.id as string;
  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "note",
    entityId: id,
    action: "create",
    after: { about: `${opts.entity}:${opts.entityId}`, kind: opts.kind, due: opts.dueAt ?? null },
    sourceScreen: "56",
  });
  return id;
}

/**
 * Notes that are also something to do. Screen 55 reads these.
 *
 * From here rather than from a second list — one place it is written, many
 * places it is read.
 */
export async function notesDue(): Promise<
  { id: string; entity: string; entityId: string; body: string; dueAt: Date }[]
> {
  const rows = await db
    .select()
    .from(note)
    .where(and(isNull(note.deletedAt), isNull(note.doneAt), sql`${note.dueAt} is not null`))
    .orderBy(asc(note.dueAt));

  return rows.map((row) => ({
    id: row.id,
    entity: row.entity,
    entityId: row.entityId,
    body: row.body,
    dueAt: new Date(`${row.dueAt}T00:00:00Z`),
  }));
}
