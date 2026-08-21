import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { intakeMessage } from "@/db/schema/intake";
import { person } from "@/db/schema/party";
import { nameFromEmail } from "../merge";
import type { RoutedTo } from "./routing";

/**
 * Screen 02 — turning a captured message into a record.
 *
 * Two of the seven actions on the screen can complete today, because their
 * destination tables exist: a CV becomes a candidate, and a new sender at a
 * known client becomes a contact. The other five need deals, tenders, sourcing,
 * invoices or tasks, and are shown greyed with the phase that brings them
 * rather than as buttons that do nothing.
 *
 * Everything here is a person pressing a button. Nothing in this file runs on
 * its own — LAW 2, and screen 38's "Nothing is auto-created below 85%".
 */

export class CannotCommitYet extends Error {
  constructor(
    readonly what: RoutedTo,
    readonly phase: number,
  ) {
    super("cannotCommitYet");
  }
}

/** Which actions have somewhere to write, and which phase brings the rest. */
export const COMMIT_PHASE: Record<RoutedTo, number | null> = {
  candidate: null, // person exists — phase 1
  enquiry: 4,
  tender: 4,
  supplierQuote: 4,
  payment: 5,
  needsReview: null, // reclassify, not commit
};

async function recordCommit(opts: {
  messageId: string;
  entity: string;
  entityId: string;
  actorId: string;
  after: Record<string, unknown>;
}) {
  await db
    .update(intakeMessage)
    .set({
      status: "committed",
      committedEntity: opts.entity,
      committedEntityId: opts.entityId,
      committedAt: new Date(),
      // A text id, because the actor may one day be a job rather than a user.
      committedBy: null,
    })
    .where(eq(intakeMessage.id, opts.messageId));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: opts.entity,
    entityId: opts.entityId,
    action: "create",
    after: { ...opts.after, fromIntakeMessage: opts.messageId },
    sourceScreen: "02",
  });
}

/**
 * A CV from somebody we do not know becomes a candidate.
 *
 * The name comes from the sender's display name when there is one, and is
 * guessed from the address only as a fallback — `nameFromEmail` already refuses
 * role mailboxes, so "contact@" never becomes a person called Contact.
 *
 * The trade is NOT guessed. Screen 51 makes trade a required field precisely
 * because it is what people search by, and a trade invented from a subject line
 * is worse than one left for a person to fill in.
 */
export async function commitCandidate(opts: { messageId: string; actorId: string; trade: string }) {
  const [message] = await db
    .select()
    .from(intakeMessage)
    .where(eq(intakeMessage.id, opts.messageId))
    .limit(1);
  if (!message) throw new Error("noSuchMessage");

  const fullName = message.fromName?.trim() || nameFromEmail(message.fromAddress ?? "") || null;
  if (!fullName) throw new Error("noNameToUse");

  const trade = opts.trade.trim();
  if (!trade) throw new Error("tradeRequired");

  const [created] = await db
    .insert(person)
    .values({
      fullName,
      trade,
      email: message.fromAddress,
      source: "cv",
      relationship: "candidate",
      employerPartyId: null,
    })
    .returning({ id: person.id });

  const id = created?.id as string;
  await recordCommit({
    messageId: opts.messageId,
    entity: "person",
    entityId: id,
    actorId: opts.actorId,
    after: { fullName, trade, relationship: "candidate", source: "cv" },
  });

  return id;
}

/**
 * Screen 02's second card: "new sender at a known client — add as contact under
 * URBACON (UCC)?"
 *
 * This is the cheapest useful thing the inbox does. Somebody new writes from a
 * company we already know, and instead of that address being retyped into a
 * phone six weeks later, it becomes a contact in one click.
 */
export async function commitContact(opts: {
  messageId: string;
  actorId: string;
  job: string;
  partyId?: string;
}) {
  const [message] = await db
    .select()
    .from(intakeMessage)
    .where(eq(intakeMessage.id, opts.messageId))
    .limit(1);
  if (!message) throw new Error("noSuchMessage");

  const partyId = opts.partyId ?? message.partyId;
  if (!partyId) throw new Error("companyRequired");

  const fullName = message.fromName?.trim() || nameFromEmail(message.fromAddress ?? "") || null;
  if (!fullName) throw new Error("noNameToUse");

  const [created] = await db
    .insert(person)
    .values({
      fullName,
      trade: opts.job.trim() || "unspecified",
      email: message.fromAddress,
      employerPartyId: partyId,
      source: "direct",
      relationship: "external",
      // They wrote to us, so the address demonstrably reaches them. That is
      // exactly what screen 76 means by verified, and it is a fact, not a guess.
      verifiedAt: new Date(),
      lastContactAt: message.receivedAt,
    })
    .returning({ id: person.id });

  const id = created?.id as string;
  await recordCommit({
    messageId: opts.messageId,
    entity: "person",
    entityId: id,
    actorId: opts.actorId,
    after: { fullName, partyId, relationship: "external" },
  });

  return id;
}

/** What the button on a row should do, and whether it can do it yet. */
export function commitAvailability(what: RoutedTo | null) {
  if (!what) return { available: false, phase: null as number | null };
  const phase = COMMIT_PHASE[what];
  return { available: phase === null, phase };
}
