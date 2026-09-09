import { and, asc, desc, eq, gt, isNull, lt, ne } from "drizzle-orm";
import { db } from "@/db";
import { intakeDossier } from "@/db/schema/dossier";
import { intakeAttachment, intakeMessage } from "@/db/schema/intake";
import { party } from "@/db/schema/party";
import { plainText } from "./body";
import { DEADLINE_WARNING_HOURS } from "./inbox";
import type { RoutedTo } from "./routing";

/**
 * One message, whole — the screen the design never drew.
 *
 * Screen 02 assumed triage without reading: classify, create, dismiss, straight
 * from the row. That survives contact with a demo mailbox and not with a real
 * one. On the first real sync, 31 of 39 messages came back `needsReview`, and
 * "needs review" means precisely that a person has to READ it. There was
 * nowhere to.
 *
 * Recorded in docs/DECISIONS/2026-08-27-message-view.md.
 */

export type MessageAttachment = {
  id: string;
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
  looksLike: string | null;
  /** Null while the bytes have not been fetched. Today that is always. */
  storagePath: string | null;
  /**
   * The archive this file came out of, when it came out of one. `filename` is
   * then the path inside it — `annexes/bordereau.pdf` — and the screen lists it
   * under the archive rather than beside it.
   */
  parentAttachmentId: string | null;
  /**
   * The reading of this file, once one exists (task 1.8).
   *
   * An extraction nobody can reach from the message it arrived on is an
   * extraction nobody knows happened — screen 39's "Read so far" list is a log,
   * not a route. This is the link from the paperclip to what was read from it.
   */
  dossierId: string | null;
};

export type MessageDetail = {
  id: string;
  channelKey: string;
  receivedAt: Date;
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  /** Already stripped of markup. Never rendered as HTML — see ./body.ts. */
  body: string;
  classifiedAs: RoutedTo | null;
  confidence: number | null;
  downgraded: boolean;
  partyId: string | null;
  partyName: string | null;
  deadlineAt: Date | null;
  deadlineConfirmed: boolean;
  hoursLeft: number | null;
  urgent: boolean;
  read: boolean;
  status: string;
  /** Back to the real thing in Outlook, with its formatting and attachments. */
  webLink: string | null;
  committedEntity: string | null;
  committedEntityId: string | null;
  attachments: MessageAttachment[];
};

export async function messageDetail(id: string): Promise<MessageDetail | null> {
  const [row] = await db
    .select({
      id: intakeMessage.id,
      channelKey: intakeMessage.channelKey,
      receivedAt: intakeMessage.receivedAt,
      fromName: intakeMessage.fromName,
      fromAddress: intakeMessage.fromAddress,
      subject: intakeMessage.subject,
      bodyText: intakeMessage.bodyText,
      classifiedAs: intakeMessage.classifiedAs,
      confidence: intakeMessage.confidence,
      raw: intakeMessage.raw,
      partyId: intakeMessage.partyId,
      partyName: party.legalName,
      deadlineAt: intakeMessage.deadlineAt,
      deadlineConfirmedAt: intakeMessage.deadlineConfirmedAt,
      readAt: intakeMessage.readAt,
      status: intakeMessage.status,
      committedEntity: intakeMessage.committedEntity,
      committedEntityId: intakeMessage.committedEntityId,
    })
    .from(intakeMessage)
    .leftJoin(party, eq(intakeMessage.partyId, party.id))
    .where(eq(intakeMessage.id, id))
    .limit(1);

  if (!row) return null;

  const files = await db
    .select({
      id: intakeAttachment.id,
      filename: intakeAttachment.filename,
      contentType: intakeAttachment.contentType,
      sizeBytes: intakeAttachment.sizeBytes,
      looksLike: intakeAttachment.looksLike,
      storagePath: intakeAttachment.storagePath,
      parentAttachmentId: intakeAttachment.parentAttachmentId,
    })
    .from(intakeAttachment)
    .where(eq(intakeAttachment.messageId, id))
    .orderBy(asc(intakeAttachment.filename));

  /*
    The readings, in a second query rather than a join.

    A join to `intake_dossier` would multiply this list the day an attachment
    has two readings — which is exactly what a re-read would be — and the list
    of files on a message must be the files on the message. One query, matched
    in memory, over a handful of rows.
  */
  const readings = await db
    .select({ id: intakeDossier.id, attachmentId: intakeDossier.attachmentId })
    .from(intakeDossier)
    .where(eq(intakeDossier.messageId, id));

  const readingOf = new Map(
    readings.filter((r) => r.attachmentId).map((r) => [r.attachmentId as string, r.id]),
  );

  const raw = row.raw as { webLink?: string; downgraded?: boolean } | null;
  const hoursLeft = row.deadlineAt
    ? Math.round((row.deadlineAt.getTime() - Date.now()) / 3_600_000)
    : null;

  return {
    id: row.id,
    channelKey: row.channelKey,
    receivedAt: row.receivedAt,
    fromName: row.fromName,
    fromAddress: row.fromAddress,
    subject: row.subject,
    body: plainText(row.bodyText),
    classifiedAs: (row.classifiedAs as RoutedTo | null) ?? null,
    confidence: row.confidence === null ? null : Number(row.confidence),
    downgraded: raw?.downgraded === true,
    partyId: row.partyId,
    partyName: row.partyName,
    deadlineAt: row.deadlineAt,
    deadlineConfirmed: row.deadlineConfirmedAt !== null,
    hoursLeft,
    urgent: hoursLeft !== null && hoursLeft <= DEADLINE_WARNING_HOURS,
    read: row.readAt !== null,
    status: row.status,
    webLink: raw?.webLink ?? null,
    committedEntity: row.committedEntity,
    committedEntityId: row.committedEntityId,
    attachments: files.map((file) => ({ ...file, dossierId: readingOf.get(file.id) ?? null })),
  };
}

/**
 * The message before and after this one, in the order the inbox lists them.
 *
 * Triage is a run, not a visit. Thirty-one things need reading; making somebody
 * return to the list between each one turns ten minutes into thirty.
 *
 * Ordered by arrival rather than by the list's deadline-first sort, because
 * this is the one place the order has to stay stable while you work: confirming
 * a deadline mid-run would otherwise move the message you are standing on.
 */
export async function neighbours(
  id: string,
): Promise<{ previous: string | null; next: string | null }> {
  const [current] = await db
    .select({ receivedAt: intakeMessage.receivedAt })
    .from(intakeMessage)
    .where(eq(intakeMessage.id, id))
    .limit(1);

  if (!current) return { previous: null, next: null };

  const open = and(ne(intakeMessage.status, "dismissed"), isNull(intakeMessage.committedAt));

  const [newer] = await db
    .select({ id: intakeMessage.id })
    .from(intakeMessage)
    .where(and(open, gt(intakeMessage.receivedAt, current.receivedAt)))
    .orderBy(asc(intakeMessage.receivedAt))
    .limit(1);

  const [older] = await db
    .select({ id: intakeMessage.id })
    .from(intakeMessage)
    .where(and(open, lt(intakeMessage.receivedAt, current.receivedAt)))
    .orderBy(desc(intakeMessage.receivedAt))
    .limit(1);

  // The list is newest first, so "previous" is the newer one.
  return { previous: newer?.id ?? null, next: older?.id ?? null };
}
