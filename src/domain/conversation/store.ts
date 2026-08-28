import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { intakeAttachment, intakeMessage } from "@/db/schema/intake";
import { party, partyRole } from "@/db/schema/party";
import { plainText, preview } from "../intake/body";
import { stateOf, type ThreadState, threadKey, titleOf } from "./thread";

/**
 * Screen 57's data. Read from `intake_message`; nothing here is stored.
 *
 * The grouping happens in JavaScript rather than SQL, on purpose. The rule -
 * strip reply prefixes, group by counterparty - lives in ./thread.ts where it
 * is tested against the subjects a French purchasing department actually
 * produces. Expressing it again in SQL would mean two rules that have to agree
 * forever, and the day they disagree the screen is wrong in a way nobody can
 * see. At six users and a few hundred messages the cost is a rounding error.
 *
 * The limit is the honest part of that trade: this reads the most recent
 * messages, not all of them. When contact@ has been syncing for a year, this
 * needs a real query. It is not that day.
 */
const WINDOW = 1000;

export const THREAD_FACETS = [
  "all",
  "needsReply",
  "client",
  "supplier",
  "authority",
  "unmatched",
] as const;
export type ThreadFacet = (typeof THREAD_FACETS)[number];

export function isThreadFacet(value: string | undefined): value is ThreadFacet {
  return THREAD_FACETS.includes(value as ThreadFacet);
}

export type ThreadSummary = {
  key: string;
  /** Any message in it — how the screen addresses the thread in a URL. */
  anchorId: string;
  partyId: string | null;
  counterparty: string;
  roles: string[];
  /** Which language this counterparty is written to in. Screen 57's chip. */
  emailLocale: string;
  title: string;
  lastAt: Date;
  lastFrom: string;
  preview: string;
  count: number;
  state: ThreadState;
  unread: number;
};

type Row = {
  id: string;
  receivedAt: Date;
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  bodyText: string | null;
  status: string;
  committedAt: Date | null;
  readAt: Date | null;
  partyId: string | null;
  partyName: string | null;
  emailLocale: string | null;
  raw: unknown;
};

async function recentMessages(): Promise<Row[]> {
  return db
    .select({
      id: intakeMessage.id,
      receivedAt: intakeMessage.receivedAt,
      fromName: intakeMessage.fromName,
      fromAddress: intakeMessage.fromAddress,
      subject: intakeMessage.subject,
      bodyText: intakeMessage.bodyText,
      status: intakeMessage.status,
      committedAt: intakeMessage.committedAt,
      readAt: intakeMessage.readAt,
      partyId: intakeMessage.partyId,
      partyName: party.legalName,
      emailLocale: party.emailLocale,
      raw: intakeMessage.raw,
    })
    .from(intakeMessage)
    .leftJoin(party, eq(intakeMessage.partyId, party.id))
    .orderBy(desc(intakeMessage.receivedAt))
    .limit(WINDOW);
}

/** Which roles each party holds — client, supplier, authority. */
async function rolesByParty(partyIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (partyIds.length === 0) return map;

  const rows = await db
    .select({ partyId: partyRole.partyId, role: partyRole.role })
    .from(partyRole)
    .where(inArray(partyRole.partyId, partyIds));

  for (const row of rows) {
    map.set(row.partyId, [...(map.get(row.partyId) ?? []), row.role]);
  }
  return map;
}

function group(rows: Row[]): Map<string, Row[]> {
  const threads = new Map<string, Row[]>();
  for (const row of rows) {
    const key = threadKey(row.partyId, row.fromAddress, row.subject);
    threads.set(key, [...(threads.get(key) ?? []), row]);
  }
  return threads;
}

export async function listThreads(facet: ThreadFacet = "all"): Promise<ThreadSummary[]> {
  const rows = await recentMessages();
  const roles = await rolesByParty([
    ...new Set(rows.map((r) => r.partyId).filter((id): id is string => id !== null)),
  ]);

  const summaries: ThreadSummary[] = [];

  for (const [key, messages] of group(rows)) {
    // recentMessages is newest first, so index 0 is the latest message and the
    // title comes from the reversed list further down.
    const newest = messages[0] as Row;
    const partyRoles = newest.partyId ? (roles.get(newest.partyId) ?? []) : [];

    summaries.push({
      key,
      anchorId: newest.id,
      partyId: newest.partyId,
      counterparty: newest.partyName ?? newest.fromName ?? newest.fromAddress ?? "",
      roles: partyRoles,
      emailLocale: newest.emailLocale ?? "fr",
      title: titleOf([...messages].reverse().map((m) => m.subject)),
      lastAt: newest.receivedAt,
      lastFrom: newest.fromName ?? newest.fromAddress ?? "",
      preview: preview(newest.bodyText, 120),
      count: messages.length,
      state: stateOf(messages),
      unread: messages.filter((m) => m.readAt === null).length,
    });
  }

  const wanted = summaries.filter((thread) => {
    switch (facet) {
      case "all":
        return true;
      case "needsReply":
        return thread.state === "needsReply";
      case "unmatched":
        return thread.partyId === null;
      default:
        return thread.roles.includes(facet);
    }
  });

  return wanted.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}

export type ThreadCounts = Record<ThreadFacet, number>;

export async function threadCounts(): Promise<ThreadCounts> {
  const all = await listThreads("all");
  const counts = {
    all: all.length,
    needsReply: 0,
    client: 0,
    supplier: 0,
    authority: 0,
    unmatched: 0,
  } as ThreadCounts;

  for (const thread of all) {
    if (thread.state === "needsReply") counts.needsReply += 1;
    if (thread.partyId === null) counts.unmatched += 1;
    for (const role of thread.roles) {
      if (role === "client" || role === "supplier" || role === "authority") counts[role] += 1;
    }
  }
  return counts;
}

export type ThreadMessageView = {
  id: string;
  receivedAt: Date;
  fromName: string;
  fromAddress: string | null;
  subject: string | null;
  body: string;
  read: boolean;
  committed: boolean;
  dismissed: boolean;
  webLink: string | null;
  attachments: { id: string; filename: string }[];
};

export type ThreadDetail = ThreadSummary & { messages: ThreadMessageView[] };

/**
 * One thread, addressed by any message inside it.
 *
 * By a message id rather than the thread key, because the key contains a
 * subject line — putting that in a URL means every reply prefix, accent and
 * slash a client ever typed has to survive being encoded twice, and the first
 * one that does not silently opens the wrong conversation.
 */
export async function threadOf(messageId: string): Promise<ThreadDetail | null> {
  const rows = await recentMessages();
  const anchor = rows.find((row) => row.id === messageId);
  if (!anchor) return null;

  const key = threadKey(anchor.partyId, anchor.fromAddress, anchor.subject);
  const messages = group(rows).get(key) ?? [];

  const [summary] = (await listThreads("all")).filter((thread) => thread.key === key);
  if (!summary) return null;

  const files = await db
    .select({
      id: intakeAttachment.id,
      messageId: intakeAttachment.messageId,
      filename: intakeAttachment.filename,
    })
    .from(intakeAttachment)
    .where(
      inArray(
        intakeAttachment.messageId,
        messages.map((m) => m.id),
      ),
    );

  // Oldest first: a conversation is read downwards.
  const ordered = [...messages].reverse();

  return {
    ...summary,
    messages: ordered.map((message) => ({
      id: message.id,
      receivedAt: message.receivedAt,
      fromName: message.fromName ?? message.fromAddress ?? "",
      fromAddress: message.fromAddress,
      subject: message.subject,
      body: plainText(message.bodyText),
      read: message.readAt !== null,
      committed: message.committedAt !== null,
      dismissed: message.status === "dismissed",
      // The way back to the real message. Screen 57's frame draws a composer;
      // this is what replaces it until the ERP can send. See the decision note.
      webLink: (message.raw as { webLink?: string } | null)?.webLink ?? null,
      attachments: files
        .filter((file) => file.messageId === message.id)
        .map((file) => ({ id: file.id, filename: file.filename })),
    })),
  };
}
