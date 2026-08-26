import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { document } from "@/db/schema/document";
import { intakeMessage } from "@/db/schema/intake";
import { party, partyRole, person } from "@/db/schema/party";
import {
  type CaptureMode,
  compose,
  type Reading,
  type ReadingFieldKey,
  type Resolved,
  sight,
  writeSummary,
} from "./reading";

/**
 * Screen 61 — Quick capture: the half that touches the database.
 *
 * Server only. The browser gets `./reading`, which is pure; importing this file
 * from a client component pulls `postgres` into the bundle and 500s the page.
 * See the note at the top of `reading.ts` for how that was found out.
 *
 * Two verbs, deliberately kept apart: `read()` proposes and writes nothing,
 * `save()` writes and proposes nothing. That separation is what makes screen
 * 61's caption — "Nothing is created until you press the button" — a property
 * of the code rather than a promise printed under a card.
 */

/* ------------------------------------------------------ resolving it for real */

/**
 * Who sent this, from an address.
 *
 * Three passes, cheapest first: the person's own address, the company's
 * address, then the domain. The domain pass is last and is the one that can be
 * wrong — two companies share a domain more often than anyone expects, and a
 * public domain is shared by the whole country. Free-mail domains are refused
 * outright, because `gmail.com` matching the one client who used a personal
 * address would file everybody's mail under that client.
 */
const FREE_MAIL = new Set([
  "gmail.com",
  "yahoo.com",
  "yahoo.fr",
  "hotmail.com",
  "hotmail.fr",
  "outlook.com",
  "live.fr",
  "icloud.com",
]);

export async function resolveSender(address: string | null): Promise<Resolved["party"]> {
  if (!address) return null;
  const email = address.toLowerCase().trim();
  const domain = email.split("@")[1] ?? "";

  const [viaPerson] = await db
    .select({ partyId: person.employerPartyId })
    .from(person)
    .where(sql`lower(${person.email}) = ${email} and ${person.employerPartyId} is not null`)
    .limit(1);

  const [viaParty] = viaPerson?.partyId
    ? []
    : await db
        .select({ id: party.id })
        .from(party)
        .where(sql`lower(${party.email}) = ${email}`)
        .limit(1);

  const byDomain =
    viaPerson?.partyId || viaParty || !domain || FREE_MAIL.has(domain)
      ? []
      : await db
          .select({ id: party.id })
          .from(party)
          .where(sql`lower(${party.email}) like ${`%@${domain}`}`)
          .limit(2);

  // Two companies on one domain is not a match, it is a question. Taking the
  // first row would file a subsidiary's mail under its parent silently, which
  // is worse than showing the address and asking.
  const viaDomain = byDomain.length === 1 ? byDomain[0] : undefined;

  const partyId = viaPerson?.partyId ?? viaParty?.id ?? viaDomain?.id;
  if (!partyId) return null;

  return describeParty(partyId);
}

async function describeParty(partyId: string): Promise<Resolved["party"]> {
  const [row] = await db
    .select({
      id: party.id,
      legalName: party.legalName,
      tradeName: party.tradeName,
      deletedAt: party.deletedAt,
    })
    .from(party)
    .where(eq(party.id, partyId))
    .limit(1);
  // A deleted company is not a match. Screen 83 keeps the row so it can be
  // restored, not so that new work attaches itself to it.
  if (!row || row.deletedAt) return null;

  const roles = await db
    .select({ role: partyRole.role })
    .from(partyRole)
    .where(eq(partyRole.partyId, partyId));

  return {
    id: row.id,
    name: row.tradeName?.trim() || row.legalName,
    isClient: roles.some((r) => r.role === "client" || r.role === "prospect"),
  };
}

/**
 * Does a document carry this number?
 *
 * `document.number` is null on a draft (LAW 5), so this only ever matches
 * something that was actually issued — which is right: a reference in an email
 * is a reference to a document the other side received.
 */
export async function resolveReference(reference: string): Promise<Resolved["document"]> {
  const [row] = await db
    .select({
      id: document.id,
      number: document.number,
      kind: document.kind,
      currency: document.currency,
      totals: document.totals,
    })
    .from(document)
    .where(sql`upper(${document.number}) = ${reference.toUpperCase()}`)
    .limit(1);
  if (!row?.number) return null;

  const totals = (row.totals ?? {}) as { totalIncl?: string };
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    currency: row.currency,
    totalIncl: totals.totalIncl ?? "0",
  };
}

/**
 * The whole reading, for a box of text. Reads the database; writes nothing.
 *
 * Callable as often as the person edits the box. That is a design constraint,
 * not an accident: the card has to keep up with someone pasting, deleting and
 * pasting again, so this does four indexed lookups and no more.
 */
export async function read(opts: {
  mode: CaptureMode;
  text: string;
  /** The address the person typed into "From", when they typed one. */
  fromAddress?: string | null;
  now?: Date;
}): Promise<Reading> {
  const text = opts.text ?? "";
  const sightings = sight(text);
  const today = opts.now ?? new Date();

  const address = opts.fromAddress ?? sightings.find((s) => s.kind === "email")?.value ?? null;
  const reference = sightings.find((s) => s.kind === "reference");

  const [resolvedParty, resolvedDocument] = await Promise.all([
    resolveSender(address),
    reference ? resolveReference(reference.value) : Promise.resolve(null),
  ]);

  return compose({
    mode: opts.mode,
    text,
    sightings,
    resolved: { party: resolvedParty, document: resolvedDocument },
    today,
  });
}

export class NothingToSave extends Error {
  constructor() {
    super("nothingToSave");
  }
}

/**
 * The button.
 *
 * One insert, and an audit entry that records what the person was shown when
 * they pressed it. The second half matters more than it looks: six weeks later
 * the question is never "what did the system write", it is "what did it claim
 * before it wrote", and the only way to answer that is to keep the reading.
 */
export async function save(opts: {
  mode: CaptureMode;
  text: string;
  reading: Reading;
  actorId: string;
  fromAddress?: string | null;
  now?: Date;
}): Promise<string> {
  if (opts.reading.tooThin || opts.reading.writes.length === 0) throw new NothingToSave();

  const planned = writeSummary(opts.reading);
  // The plan is the contract. If this ever disagrees with what the function
  // below does, it is the function that changed and forgot to say so.
  if (planned.join(",") !== "intake_message") throw new Error("writePlanChanged");

  const field = (key: ReadingFieldKey) => opts.reading.fields.find((f) => f.key === key);
  const partyId = field("from")?.ref?.id ?? null;
  const documentRef = field("about")?.ref?.id ?? null;
  const followUp = field("followUp")?.values[0] ?? null;
  const now = opts.now ?? new Date();

  const [created] = await db
    .insert(intakeMessage)
    .values({
      // "phone_note" is a channel screen 38 has been counting as NOT BUILT
      // since the first day. This is the line that makes it live.
      channelKey: opts.mode === "phone" ? "phone_note" : "manual",
      receivedAt: now,
      fromAddress: opts.fromAddress ?? null,
      subject: firstLine(opts.text),
      bodyText: opts.text,
      partyId,
      // Read, not confirmed. LAW 2 — the shape the assistant guessed does not
      // become the truth because somebody clicked Save on a note.
      classifiedAs: shapeOf(opts.reading),
      confidence: String(field("this")?.confidence ?? 0),
      status: partyId ? "classified" : "needs_review",
      // Everything the card showed, so the audit trail can reproduce the screen.
      raw: {
        capturedVia: "screen61",
        mode: opts.mode,
        documentId: documentRef,
        filedToProposal: field("filedTo")?.values ?? [],
        followUpProposal: followUp,
        fields: opts.reading.fields,
      },
      readAt: now,
    })
    .returning({ id: intakeMessage.id });

  const id = created?.id as string;

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "intake_message",
    entityId: id,
    action: "create",
    after: {
      mode: opts.mode,
      shape: shapeOf(opts.reading),
      partyId,
      documentId: documentRef,
      followUpProposal: followUp,
      // Named so that a later reader knows the reminder was shown and NOT set.
      followUpScheduled: false,
    },
    sourceScreen: "61",
  });

  return id;
}

function shapeOf(reading: Reading): string {
  const key = reading.fields.find((f) => f.key === "this")?.labelKey ?? "shape.unknown";
  return key.replace(/^shape\./, "");
}

function firstLine(text: string): string | null {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  if (!line) return null;
  return line.length > 180 ? `${line.slice(0, 177)}…` : line;
}
