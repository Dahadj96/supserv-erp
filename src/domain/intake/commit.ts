import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { intakeMessage } from "@/db/schema/intake";
import { party, person } from "@/db/schema/party";
import { createDeal } from "../deal/deal";
import { nameFromEmail } from "../merge";
import { createParty } from "../party";
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

/**
 * The company an enquiry is for, when the sender is attached to none.
 *
 * WHY THIS EXISTS. `commitEnquiry` refuses without a company and says so, and
 * the comment above it sent people "one step earlier — link them to a company
 * as a contact first". That step did not exist. `commitContact` also requires a
 * `partyId`, and screen 02 only ever offered it when the sender was ALREADY
 * matched to a company. So a first RFQ, arriving at an ERP with no companies in
 * it yet, was a dead end: a greyed button whose only explanation was a tooltip.
 *
 * That is the normal way work arrives here. An enquiry from somebody new is not
 * an edge case — for a company bidding on marchés publics it is most of the
 * post — and an ERP that requires the client to have been registered in advance
 * is one people work around by answering in Word.
 *
 * WHAT IT WILL NOT DO. It does not invent the company. Either a person picked
 * an existing one from the look-alikes the screen showed them, or they read a
 * name in a field and submitted it. `createParty` needs nothing but that name
 * and a role — its own comment explains why the décret 05-468 fields stay
 * optional here and the rule bites at invoice time instead.
 *
 * The address becomes the COMPANY's only when it is a role mailbox.
 * `contact@` and `commercial@` belong to the company; `m.belkacem@` belongs to
 * a man who may leave, and putting his address on the company record is how a
 * facture ends up going to somebody who left in 2024. `nameFromEmail` already
 * knows the difference — it returns null for exactly the role mailboxes — so
 * the two readings stay one list.
 */
export async function attachSenderCompany(opts: {
  messageId: string;
  actorId: string;
  /** An existing company the person chose. */
  partyId?: string;
  /** Or the name they typed for a new one. */
  legalName?: string;
}): Promise<string> {
  const [message] = await db
    .select()
    .from(intakeMessage)
    .where(eq(intakeMessage.id, opts.messageId))
    .limit(1);
  if (!message) throw new Error("noSuchMessage");

  let partyId = opts.partyId?.trim() || null;

  if (partyId) {
    const [chosen] = await db
      .select({ id: party.id })
      .from(party)
      .where(eq(party.id, partyId))
      .limit(1);
    if (!chosen) throw new Error("noSuchCompany");
  } else {
    const legalName = opts.legalName?.trim() ?? "";
    if (legalName.length < 2) throw new Error("companyNameRequired");

    const from = message.fromAddress ?? "";
    const roleMailbox = from.length > 0 && nameFromEmail(from) === null;

    const created = await createParty(
      {
        legalName,
        roles: ["client"],
        email: roleMailbox ? from : "",
        docLocale: "fr",
        emailLocale: "fr",
        currency: "DZD",
      },
      opts.actorId,
    );
    partyId = created.id;
  }

  /*
    AND THE PERSON WHO WROTE IT, saved under that company.

    Asked for in those words: "there is no quickly create company and save
    contact, so I can create the enquiry". Three records are wanted and it was
    three screens, two of which could not be reached from here.

    Nothing is invented. The name is the one on the email, the address is one
    that demonstrably reaches them because they used it, and `verifiedAt` means
    exactly that on screen 76. The TRADE is not guessed — it is left as
    `unspecified`, the same word `commitContact` writes when the job box is
    blank, because a job title read off a subject line is worse than an empty
    field somebody fills in later.

    A role mailbox produces no person at all: `nameFromEmail` returns null for
    `commercial@`, and a contact card called "Commercial" is one somebody will
    eventually address an email to.
  */
  let personId = message.personId;

  if (!personId) {
    const from = (message.fromAddress ?? "").trim();

    /*
      THE ADDRESS DECIDES WHETHER THERE IS A PERSON. The display name only
      decides what to call them.

      Written the other way round first — `fromName || nameFromEmail(from)` —
      and a test caught it: `commercial@touatgaz.dz` arrives with "TOUATGAZ" in
      the display name, so the role-mailbox guard was skipped and the ERP would
      have recorded a man called TOUATGAZ, employed by TOUATGAZ. A company's
      own name in the From line is the commonest display name there is.
    */
    const human = from ? nameFromEmail(from) : null;
    const fullName = human ? message.fromName?.trim() || human : null;

    if (fullName) {
      const [already] = from
        ? await db
            .select({ id: person.id })
            .from(person)
            .where(
              and(sql`lower(${person.email}) = ${from.toLowerCase()}`, isNull(person.deletedAt)),
            )
            .limit(1)
        : [];

      if (already) {
        personId = already.id;
        /*
          FILED, if they were loose.

          A person can already be on file with this address and no employer —
          typed into screen 51 by hand, or left behind by a company that was
          merged away. Reusing them and not filing them leaves the contact
          exactly as unattached as the message was, which is the bug this
          whole function exists to end. A test caught it.

          Somebody who already HAS an employer keeps it: moving a man between
          companies because he sent an email is a decision, and it is not this
          function's to make.
        */
        await db
          .update(person)
          .set({ employerPartyId: partyId, lastContactAt: message.receivedAt })
          .where(and(eq(person.id, already.id), isNull(person.employerPartyId)));
      } else {
        const [created] = await db
          .insert(person)
          .values({
            fullName,
            trade: "unspecified",
            email: from || null,
            employerPartyId: partyId,
            source: "direct",
            relationship: "external",
            verifiedAt: new Date(),
            lastContactAt: message.receivedAt,
          })
          .returning({ id: person.id });
        personId = created?.id ?? null;
      }
    }
  }

  // The message now knows whose it is. Until this line existed, `party_id` was
  // written once by `identifySender` at INGEST and never again — so a company
  // created five minutes after the email arrived could not be found by it, and
  // the screen went on saying the sender belonged to nobody however many
  // companies and contacts somebody typed in by hand.
  await db
    .update(intakeMessage)
    .set({ partyId, personId })
    .where(eq(intakeMessage.id, opts.messageId));

  return partyId;
}
