import { and, desc, eq, sql } from "drizzle-orm";
import {
  fetchAttachments,
  fetchMessagesSince,
  type GraphMessage,
  MailboxNotScoped,
} from "@/capture/mail/graph";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { intakeAttachment, intakeChannel, intakeMessage } from "@/db/schema/intake";
import { party, partyRole, person } from "@/db/schema/party";
import { listRules } from "./channels";
import { type RoutableMessage, route } from "./routing";

export const MAILBOX = "mailbox";

/**
 * Screen 02 and 38 — the mailbox poll.
 *
 * Nothing here decides anything. It captures what arrived, asks the router what
 * it looks like, and writes both down. Records are created later, by a person,
 * on screen 40 — LAW 2.
 */

/** A CV, a quote, a delivery note — guessed from the filename, refined by OCR later. */
export function attachmentLooksLike(filename: string): string {
  const n = filename.toLowerCase();
  if (/\b(cv|resume|curriculum)\b/.test(n)) return "cv";
  if (/\b(facture|invoice|fact)\b/.test(n)) return "invoice";
  if (/\b(devis|offre|quote|proforma|cotation)\b/.test(n)) return "quote";
  if (/\b(bl|bon de livraison|delivery)\b/.test(n)) return "delivery_note";
  if (/\b(cahier|charges|cctp|dossier|appel)\b/.test(n)) return "tender_dossier";
  return "unknown";
}

/**
 * Who sent this.
 *
 * The address is matched against companies first, then against the people we
 * know — because "k.mansouri@ets-sud.dz" tells you the company from its domain
 * even when that exact person is not on file yet.
 */
async function identifySender(address: string | null) {
  if (!address) return { partyId: null, personId: null, isSupplier: false };

  const clean = address.trim().toLowerCase();
  const domain = clean.split("@")[1] ?? "";

  const [byPerson] = await db
    .select({ id: person.id, employerPartyId: person.employerPartyId })
    .from(person)
    .where(and(sql`lower(${person.email}) = ${clean}`, sql`${person.deletedAt} is null`))
    .limit(1);

  let partyId = byPerson?.employerPartyId ?? null;

  if (!partyId && domain) {
    const [byParty] = await db
      .select({ id: party.id })
      .from(party)
      .where(
        and(
          sql`split_part(lower(${party.email}), '@', 2) = ${domain}`,
          sql`${party.deletedAt} is null`,
          sql`${party.supersededBy} is null`,
        ),
      )
      .limit(1);
    partyId = byParty?.id ?? null;
  }

  let isSupplier = false;
  if (partyId) {
    const [role] = await db
      .select({ role: partyRole.role })
      .from(partyRole)
      .where(and(eq(partyRole.partyId, partyId), eq(partyRole.role, "supplier")))
      .limit(1);
    isSupplier = Boolean(role);
  }

  return { partyId, personId: byPerson?.id ?? null, isSupplier };
}

/**
 * Where to resume from.
 *
 * The watermark is the newest message actually stored, not a clock — a clock
 * skips anything that arrived while the last run was in flight. One minute is
 * subtracted because Graph's `ge` filter is on the server's received time and
 * two messages can share a second.
 */
async function watermark(): Promise<Date> {
  const [latest] = await db
    .select({ at: intakeMessage.receivedAt })
    .from(intakeMessage)
    .where(eq(intakeMessage.channelKey, MAILBOX))
    .orderBy(desc(intakeMessage.receivedAt))
    .limit(1);

  if (latest?.at) return new Date(latest.at.getTime() - 60_000);
  // First ever run. Thirty days back, so a fresh install has something to show
  // without pulling years of mail nobody will read.
  return new Date(Date.now() - 30 * 86_400_000);
}

export type PollResult = {
  fetched: number;
  stored: number;
  skipped: number;
  autoClassified: number;
  needsReview: number;
};

export async function pollMailbox(actorId = "system"): Promise<PollResult> {
  const since = await watermark();
  const messages = await fetchMessagesSince(since);
  const rules = await listRules();

  const result: PollResult = {
    fetched: messages.length,
    stored: 0,
    skipped: 0,
    autoClassified: 0,
    needsReview: 0,
  };

  for (const message of messages) {
    const stored = await storeOne(message, rules, actorId);
    if (!stored) {
      result.skipped++;
      continue;
    }
    result.stored++;
    if (stored.mode === "auto") result.autoClassified++;
    if (stored.creates === "needsReview") result.needsReview++;
  }

  if (result.stored > 0) {
    await db
      .update(intakeChannel)
      .set({ lastReceivedAt: new Date() })
      .where(eq(intakeChannel.key, MAILBOX));
  }

  return result;
}

async function storeOne(
  message: GraphMessage,
  rules: Awaited<ReturnType<typeof listRules>>,
  actorId: string,
) {
  // Graph ids are stable, so the same message fetched twice is stored once.
  // The watermark overlaps by a minute on purpose; this is what absorbs it.
  const [already] = await db
    .select({ id: intakeMessage.id })
    .from(intakeMessage)
    .where(and(eq(intakeMessage.channelKey, MAILBOX), eq(intakeMessage.externalId, message.id)))
    .limit(1);
  if (already) return null;

  const address = message.from?.emailAddress?.address ?? null;
  const sender = await identifySender(address);

  const attachments = message.hasAttachments ? await fetchAttachments(message.id) : [];
  const kinds = attachments.map((a) => attachmentLooksLike(a.name));

  const routable: RoutableMessage = {
    subject: message.subject,
    bodyText: message.body?.content ?? message.bodyPreview ?? null,
    senderIsKnownCompany: sender.partyId !== null,
    senderIsKnownSupplier: sender.isSupplier,
    attachmentKinds: kinds,
  };

  const decision = route(routable, rules);

  const [row] = await db
    .insert(intakeMessage)
    .values({
      channelKey: MAILBOX,
      externalId: message.id,
      receivedAt: new Date(message.receivedDateTime),
      fromAddress: address,
      fromName: message.from?.emailAddress?.name ?? null,
      subject: message.subject,
      bodyText: message.body?.content ?? message.bodyPreview ?? null,
      partyId: sender.partyId,
      personId: sender.personId,
      status: "needs_review",
      classifiedAs: decision.creates,
      confidence: decision.confidence.toFixed(3),
      matchedRuleId: decision.rule?.id ?? null,
      // The original stays in the mailbox; this is the link back to it. Screen
      // 38: "Original email kept as the archive — Always."
      raw: {
        internetMessageId: message.internetMessageId,
        webLink: message.webLink,
        matched: decision.matched,
        downgraded: decision.downgraded,
        mode: decision.mode,
      },
    })
    .returning({ id: intakeMessage.id });

  const messageId = row?.id as string;

  if (attachments.length > 0) {
    await db.insert(intakeAttachment).values(
      attachments.map((a, i) => ({
        messageId,
        filename: a.name,
        contentType: a.contentType,
        sizeBytes: a.size,
        looksLike: kinds[i] ?? "unknown",
      })),
    );
  }

  await db.insert(auditEntry).values({
    actorId,
    actorKind: "system",
    entity: "intake_message",
    entityId: messageId,
    action: "capture",
    after: {
      channel: MAILBOX,
      classifiedAs: decision.creates,
      confidence: decision.confidence,
      rule: decision.rule?.labelKey ?? null,
      downgraded: decision.downgraded,
    },
    sourceScreen: "38",
  });

  return decision;
}

/** Screen 38 shows this channel's real state, including why it is not live. */
export async function mailboxStatus() {
  try {
    const [row] = await db
      .select()
      .from(intakeChannel)
      .where(eq(intakeChannel.key, MAILBOX))
      .limit(1);
    return { configured: Boolean(row), reason: null as string | null };
  } catch (error) {
    if (error instanceof MailboxNotScoped) return { configured: false, reason: error.detail };
    throw error;
  }
}
