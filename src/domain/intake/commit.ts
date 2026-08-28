import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { intakeMessage } from "@/db/schema/intake";
import { person } from "@/db/schema/party";
import { createDeal } from "../deal/deal";
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

/**
 * What stops each action, or null when nothing does.
 *
 * This used to be a phase number, and the number was a lie for a fortnight.
 * The table was written in phase 2 saying "enquiry: 4, payment: 5"; phases 4
 * and 5 both closed, deals and invoices exist, and the buttons went on telling
 * people to wait for something that had already shipped.
 *
 * A phase number is a promise about the future and nobody owns it. A message
 * key naming what is actually missing cannot rot in the same way — when the
 * missing thing arrives, the person building it deletes the line, because the
 * line describes their work rather than a date.
 */
export const COMMIT_BLOCKER: Record<RoutedTo, string | null> = {
  candidate: null, // a person — phase 1
  enquiry: null, // a deal — phase 4
  tender: null, // a deal carrying a tender's submission rules — phase 4
  // Sourcing requests exist. Attaching a supplier's emailed quote to the right
  // one needs a picker on this screen, and picking the wrong request silently
  // prices an offer from the wrong quote.
  supplierQuote: "inbox.blocked.needsSourcingPicker",
  // Invoices and payment allocation exist. Which invoice this advice pays is
  // the question, and guessing it from an amount in a subject line is how
  // money gets allocated to the wrong client.
  payment: "inbox.blocked.needsInvoicePicker",
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

/**
 * What the button should do, and — when it cannot — what to say instead.
 *
 * `blocker` is a message key, never a sentence: phase 0's acceptance test was
 * "be told why a disabled button is disabled", and a disabled button that
 * explains itself in English only would fail it in French.
 */
export function commitAvailability(what: RoutedTo | null): {
  available: boolean;
  blocker: string | null;
} {
  if (!what) return { available: false, blocker: null };
  const blocker = COMMIT_BLOCKER[what];
  return { available: blocker === null, blocker };
}

/**
 * An enquiry becomes a deal — but only when we know whose enquiry it is.
 *
 * `deal.partyId` is required and always will be: an enquiry with no client is
 * not an enquiry, it is a note. So this refuses rather than inventing a
 * company from an email domain, which is how "SARL Gmail" ends up in a CRM.
 *
 * When the sender is not matched, screen 02 already has the answer one step
 * earlier — link them to a company as a contact first, and then this works.
 *
 * What is deliberately NOT guessed here:
 *   - the deadline is carried across but stays UNCONFIRMED (LAW 2). It was
 *     read out of an email by a parser; a person has to agree with it before
 *     anything depends on it.
 *   - the lines are not parsed from the body. Screen 61 does that with a
 *     person watching, and a badly-read line becomes a price.
 *   - `submissionMethod` stays `unknown`. TouatGaz refusing email submissions
 *     is exactly the kind of fact that must be recorded, never assumed.
 */
export async function commitEnquiry(opts: {
  messageId: string;
  actorId: string;
  kind?: "enquiry" | "tender";
  partyId?: string;
  subject?: string;
}): Promise<string> {
  const [message] = await db
    .select()
    .from(intakeMessage)
    .where(eq(intakeMessage.id, opts.messageId))
    .limit(1);
  if (!message) throw new Error("noSuchMessage");

  const partyId = opts.partyId ?? message.partyId;
  if (!partyId) throw new Error("companyRequired");

  const subject = (opts.subject ?? message.subject ?? "").trim();
  if (!subject) throw new Error("subjectRequired");

  const dealId = await createDeal(
    {
      partyId,
      subject,
      contactPersonId: message.personId,
      clientReference: null,
      // When it ARRIVED, not when somebody got round to opening it. The clock
      // on a client's enquiry started at their end.
      receivedAt: message.receivedAt,
      deadlineAt: message.deadlineAt,
      submissionMethod: "unknown",
      currency: "DZD",
      ownerId: opts.actorId,
      source: opts.kind === "tender" ? "tender" : "mailbox",
      intakeMessageId: message.id,
      expectedValue: null,
      clientInstructions: null,
    },
    opts.actorId,
  );

  await recordCommit({
    messageId: opts.messageId,
    entity: "deal",
    entityId: dealId,
    actorId: opts.actorId,
    after: { partyId, subject, deadlineAt: message.deadlineAt, source: opts.kind ?? "enquiry" },
  });

  return dealId;
}
