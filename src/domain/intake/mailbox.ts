import { and, desc, eq, sql } from "drizzle-orm";
import {
  AttachmentHasNoBytes,
  fetchAttachmentBytes,
  fetchAttachments,
  fetchMessagesSince,
  type GraphAttachment,
  type GraphMessage,
  MailboxNotScoped,
} from "@/capture/mail/graph";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { intakeAttachment, intakeChannel, intakeMessage } from "@/db/schema/intake";
import { party, partyRole, person } from "@/db/schema/party";
import { storageFor } from "@/storage";
import { sha256 } from "@/storage/local";
import { listRules } from "./channels";
import { type RoutableMessage, route } from "./routing";

export const MAILBOX = "mailbox";

/**
 * Where an attachment's bytes go. Same shape as `storagePathFor` in
 * `dossier.ts` and in `import/batch.ts`: a folder named after the row that owns
 * the file, and a filename with anything structural taken out of it.
 *
 * Keyed on OUR row id, not on the Graph attachment id. Graph ids are long,
 * base64-ish and change when a message is moved between folders; a path built
 * from one would stop resolving for a reason nobody could see on screen.
 */
export function storagePathFor(attachmentId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return `attachments/${attachmentId}/${safe}`;
}

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

type FetchOutcome = { outcome: "stored" | "linked" | "failed"; reason?: string };

/**
 * Fetch one attachment and put it where the ERP can serve it.
 *
 * Three outcomes, and only one of them is a fault:
 *
 *   stored  the bytes are on disk and the row points at them.
 *   linked  the attachment is a link to OneDrive or SharePoint. There is
 *           nothing to fetch, the row keeps a null path on purpose, and screen
 *           60 already says "the file is real, this copy is not".
 *   failed  the network, or Graph, on a bad day.
 *
 * Nothing here throws. An attachment that cannot be fetched must not cost the
 * message it arrived on — the row is the record that the mail exists, the
 * original is still in the mailbox, and the copy can be taken later. Once 1.3
 * moves this into a job, `failed` is what gets retried and `linked` is what
 * must not be.
 */
async function fetchInto(
  rowId: string,
  graphMessageId: string,
  attachment: GraphAttachment,
): Promise<FetchOutcome> {
  try {
    const got = await fetchAttachmentBytes(
      graphMessageId,
      attachment.id,
      attachment["@odata.type"],
    );
    const path = storagePathFor(rowId, attachment.name);

    await storageFor("working").put({ path, body: got.bytes, mime: got.contentType });

    await db
      .update(intakeAttachment)
      .set({
        storagePath: path,
        sha256: sha256(got.bytes),
        // Graph's `size` is the attachment as it sits in the mail store, which
        // includes its encoding overhead. Now that the bytes are here, the row
        // can say what screen 60 will actually hand over.
        sizeBytes: got.bytes.byteLength,
      })
      .where(eq(intakeAttachment.id, rowId));

    return { outcome: "stored" };
  } catch (error) {
    if (error instanceof AttachmentHasNoBytes) {
      return { outcome: "linked", reason: error.detail };
    }
    // Including a scope refusal. A 403 here, after the listing succeeded, is
    // the Exchange permission cache catching up — a state that clears itself,
    // and not a reason to abandon the messages this poll has already read.
    return {
      outcome: "failed",
      reason:
        error instanceof MailboxNotScoped
          ? error.detail
          : error instanceof Error
            ? error.message
            : "unknown",
    };
  }
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

  const fetched = { stored: 0, linked: 0, failed: 0 };
  const failures: { file: string; reason: string }[] = [];

  if (attachments.length > 0) {
    // The rows go in first: the path is keyed on the row id, and a row with a
    // null path is the honest state until the bytes are actually here.
    const rows = await db
      .insert(intakeAttachment)
      .values(
        attachments.map((a, i) => ({
          messageId,
          filename: a.name,
          contentType: a.contentType,
          sizeBytes: a.size,
          looksLike: kinds[i] ?? "unknown",
        })),
      )
      .returning({ id: intakeAttachment.id });

    // One at a time, deliberately. The office is on a fibre link that goes
    // down, and a dossier is a dozen files; asking for all of them at once is
    // how a poll turns into a stall.
    for (const [i, a] of attachments.entries()) {
      const rowId = rows[i]?.id;
      if (!rowId) continue;

      const { outcome, reason } = await fetchInto(rowId, message.id, a);
      fetched[outcome]++;
      if (outcome === "failed" && reason) failures.push({ file: a.name, reason });
    }
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
      // What happened to the envelope, not just to the letter. Nothing in this
      // layer logs, and a poll that quietly stored no bytes for a fortnight is
      // exactly the kind of silence this system is being repaired for.
      attachments: {
        total: attachments.length,
        ...fetched,
        ...(failures.length > 0 ? { failures } : {}),
      },
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
