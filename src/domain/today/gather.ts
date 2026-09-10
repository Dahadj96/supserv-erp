import { and, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal } from "@/db/schema/deal";
import { deliveryDetail } from "@/db/schema/delivery";
import { document } from "@/db/schema/document";
import { intakeMessage, routingRule } from "@/db/schema/intake";
import { party } from "@/db/schema/party";
import { coveredAgainst, sourceLines, sourceOf } from "@/domain/delivery/store";
import { balanceOf, daysLate } from "@/domain/money/ageing";
import { paidStateOf } from "@/domain/money/invoices";
import { dueNow } from "@/domain/money/relance";
import { billed, owings, policy, relancesFor } from "@/domain/money/store";
import { notesDue } from "@/domain/timeline/gather";
import { type Item, messageItem } from "./list";

/**
 * Screen 55 — where Today's list actually comes from.
 *
 * NOT ONE ROW IN THIS FILE IS A TODO. There is no `task` table and there will
 * not be one, because a task table is a second place the truth lives: somebody
 * pays an invoice and the task to chase it stays open until a job clears it, or
 * until a person ticks a box about work that no longer exists.
 *
 * Every item is derived from a fact some other screen already holds. An invoice
 * with a balance and a passed due date IS the chase; when the payment lands the
 * item is gone on the next page load, with nothing to clean up and nobody to
 * remember to close it.
 *
 * The cost of that choice is real and worth naming: you cannot add a personal
 * reminder to this page. Screen 61's quick capture is where a note becomes a
 * recorded fact, and then it appears here like everything else does.
 */

const DAY = 86_400_000;

/**
 * Deals whose deadline has ALREADY PASSED.
 *
 * Not part of `gather()`, and not on Today. Screen 55 filters these out twice
 * over — once in SQL below and once in `expiringNow` — because "a deadline that
 * expired yesterday is not urgent, it is finished, and putting it at the top of
 * the day with a black button is cruelty".
 *
 * The assistant wants exactly the set Today refuses to show. "What is late"
 * that cannot see a missed tender is not answering the question, so this is a
 * second query rather than a loosened first one: the two screens want
 * overlapping but genuinely different sets, and making one serve both would
 * mean weakening the rule Today is built on.
 *
 * The window is bounded. A tender missed in March is history, not lateness.
 */
export async function missedDeadlines(withinDays = 30): Promise<Item[]> {
  const rows = await db
    .select({
      id: deal.id,
      ref: deal.ref,
      subject: deal.subject,
      deadlineAt: deal.deadlineAt,
      submissionMethod: deal.submissionMethod,
      clientName: sql<
        string | null
      >`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
    })
    .from(deal)
    .leftJoin(party, eq(party.id, deal.partyId))
    .where(
      and(
        sql`${deal.deadlineAt} is not null`,
        isNull(deal.lostAt),
        sql`(${deal.decision} is null or ${deal.decision} <> 'no_bid')`,
        sql`${deal.deadlineAt} <= now()`,
        sql`${deal.deadlineAt} > now() - make_interval(days => ${withinDays})`,
      ),
    );

  return rows.map((row) => ({
    id: `deal:${row.id}`,
    kind: "tenderDeadline" as const,
    title: row.subject || row.ref,
    detail: [row.clientName, row.submissionMethod].filter(Boolean).join(" · "),
    href: `/deals/${row.id}`,
    action: "open",
    reasonKey: "today.why.deadlinePassed",
    expiresAt: row.deadlineAt,
    amount: "0",
    waitingOnThem: false,
  }));
}

/** Deals whose deadline is near. Screen 55's "Now, or it is lost". */
async function deadlines(): Promise<Item[]> {
  const rows = await db
    .select({
      id: deal.id,
      ref: deal.ref,
      subject: deal.subject,
      deadlineAt: deal.deadlineAt,
      submissionMethod: deal.submissionMethod,
      clientName: sql<
        string | null
      >`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
    })
    .from(deal)
    .leftJoin(party, eq(party.id, deal.partyId))
    .where(
      and(
        sql`${deal.deadlineAt} is not null`,
        // Walked away from, lost, or already gone — none of them is today's work.
        isNull(deal.lostAt),
        sql`(${deal.decision} is null or ${deal.decision} <> 'no_bid')`,
        sql`${deal.deadlineAt} > now()`,
        sql`${deal.deadlineAt} < now() + interval '10 days'`,
      ),
    );

  return rows.map((row) => ({
    id: `deal:${row.id}`,
    kind: "tenderDeadline" as const,
    title: row.subject || row.ref,
    detail: [row.clientName, row.submissionMethod].filter(Boolean).join(" · "),
    href: `/deals/${row.id}`,
    action: "open",
    reasonKey: "today.why.deadlineNear",
    expiresAt: row.deadlineAt,
    amount: "0",
    waitingOnThem: false,
  }));
}

/**
 * Money: invoices a relance is due on, and deliveries nobody has billed.
 *
 * Both read the ledgers screens 19, 20 and 72 read, so Today cannot disagree
 * with them about what is owed or what has gone out.
 */
async function money(now: Date): Promise<Item[]> {
  const items: Item[] = [];

  const ledger = await owings();
  const unpaid = ledger.filter((row) => Number(balanceOf(row)) > 0);
  const steps = await policy();
  const history = await relancesFor(unpaid.map((row) => row.documentId));

  for (const invoice of unpaid) {
    const due = dueNow({
      dueOn: invoice.dueOn,
      balance: balanceOf(invoice),
      policy: steps,
      history: history.get(invoice.documentId) ?? [],
      today: now,
    });
    // `dueNow` returns null when a promised date has paused the chasing, which
    // is exactly the case where the next move is theirs. So anything it hands
    // back is this person's to do, and nothing here is `waitingOnThem`.
    if (!due) continue;

    items.push({
      id: `chase:${invoice.documentId}`,
      kind: "unpaidChase",
      title: `${invoice.clientName} — ${invoice.number ?? "—"}`,
      detail: `${balanceOf(invoice)} ${invoice.currency} · ${daysLate(invoice.dueOn, now)} d`,
      href: "/payments/ageing",
      action: "chase",
      reasonKey: "today.why.overdue",
      // An unpaid invoice does not expire. It is not less collectable tomorrow,
      // and dressing it as a deadline would put it above a tender that is.
      expiresAt: null,
      amount: balanceOf(invoice),
      waitingOnThem: false,
    });
  }

  // Goods that have gone out and never been billed. Screen 72's whole case:
  // "invoicing what is delivered is the faster route to cash."
  const notes = await db
    .select({
      id: document.id,
      number: document.number,
      issuedOn: document.issuedOn,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
    })
    .from(document)
    .innerJoin(party, eq(party.id, document.partyId))
    .where(and(eq(document.kind, "delivery_note"), sql`${document.number} is not null`))
    .orderBy(desc(document.issuedOn));

  for (const note of notes) {
    const [source] = await sourceOf(note.id);
    if (!source) continue;

    const lines = await sourceLines(source.id);
    const ids = lines.map((line) => line.lineId);
    const invoiced = await coveredAgainst(ids, ["invoice", "advance_invoice", "situation"]);
    // Anything issued against any line of the source counts as billed. A
    // delivery note is not the unit of invoicing — one facture may cover three
    // of them — so "has anything been billed here" is the honest question.
    if (invoiced.some((line) => line.issued)) continue;

    items.push({
      id: `bill:${note.id}`,
      kind: "uninvoiced",
      title: `${note.number} — ${note.clientName}`,
      detail: note.issuedOn ?? "",
      href: `/invoices/new?source=${source.id}`,
      action: "invoice",
      reasonKey: "today.why.delivered",
      expiresAt: null,
      amount: "0",
      waitingOnThem: false,
    });
  }

  return items;
}

/** Messages nobody has dealt with. Screen 55's "People are waiting on you". */
async function unanswered(): Promise<Item[]> {
  const rows = await db
    .select({
      id: intakeMessage.id,
      subject: intakeMessage.subject,
      fromName: intakeMessage.fromName,
      fromAddress: intakeMessage.fromAddress,
      receivedAt: intakeMessage.receivedAt,
      classifiedAs: intakeMessage.classifiedAs,
      /*
        The rule that placed it, so the row can say why it is here in the rule's
        own words rather than in a sentence written twice. A LEFT join, because
        a message the router never matched still has a reason to be triaged.
      */
      ruleLabelKey: routingRule.labelKey,
    })
    .from(intakeMessage)
    .leftJoin(routingRule, eq(routingRule.id, intakeMessage.matchedRuleId))
    .where(
      and(
        // The same "open" the inbox uses: not dismissed, not yet committed.
        ne(intakeMessage.status, "dismissed"),
        isNull(intakeMessage.committedAt),
        sql`coalesce(${intakeMessage.classifiedAs}, '') <> 'noise'`,
      ),
    )
    .orderBy(desc(intakeMessage.receivedAt))
    .limit(20);

  return rows.map(messageItem);
}

/** The two-minute jobs: unsigned proofs, and identifiers that block an invoice. */
async function quick(): Promise<Item[]> {
  const items: Item[] = [];

  const unsigned = await db
    .select({
      id: document.id,
      number: document.number,
      issuedOn: document.issuedOn,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
    })
    .from(document)
    .innerJoin(party, eq(party.id, document.partyId))
    .leftJoin(deliveryDetail, eq(deliveryDetail.documentId, document.id))
    .where(
      and(
        eq(document.kind, "delivery_note"),
        sql`${document.number} is not null`,
        isNull(deliveryDetail.signedCopyOnFile),
      ),
    );

  for (const note of unsigned) {
    items.push({
      id: `sign:${note.id}`,
      kind: "unsignedDelivery",
      title: `${note.number} — ${note.clientName}`,
      detail: note.issuedOn ?? "",
      href: `/deliveries/${note.id}`,
      action: "attach",
      reasonKey: "today.why.unsigned",
      expiresAt: null,
      amount: "0",
      waitingOnThem: false,
    });
  }

  // A draft invoice whose client has no NIF cannot be issued. One field, and
  // it blocks a document that is otherwise finished.
  const drafts = (await billed()).filter((row) => paidStateOf(row) === "draft");
  const partyIds = [...new Set(drafts.map((row) => row.partyId))];

  if (partyIds.length > 0) {
    const missing = await db
      .select({ id: party.id, name: party.legalName })
      .from(party)
      .where(and(inArray(party.id, partyIds), isNull(party.nif)));

    for (const client of missing) {
      items.push({
        id: `nif:${client.id}`,
        kind: "missingIdentifier",
        title: client.name,
        detail: "NIF",
        href: `/companies/${client.id}`,
        action: "fill",
        reasonKey: "today.why.missingIdentifier",
        expiresAt: null,
        amount: "0",
        waitingOnThem: false,
      });
    }
  }

  return items;
}

/**
 * Notes somebody wrote down with a date on them.
 *
 * This is the one kind of item on Today that a PERSON created, and it is not a
 * contradiction of the no-task-table rule — it is the point of it. A note is
 * the only record of a thing the system never saw ("they confirmed the office
 * accepts deposits from 08:00"), it is written in exactly one place, and Today
 * reads it from there. What the rule forbids is a second copy of a fact that
 * already exists, not a fact with only one home.
 */
async function noted(): Promise<Item[]> {
  const rows = await notesDue();

  return rows.map((row) => ({
    id: `note:${row.id}`,
    kind: "note" as const,
    // The first line, which is what a person wrote first and therefore what
    // they meant.
    title: row.body.split("\n")[0]?.slice(0, 120) ?? "",
    detail: "",
    href: row.entity === "deal" ? `/deals/${row.entityId}/timeline` : "/today",
    action: "open",
    reasonKey: "today.why.youAsked",
    // A note's date is a date somebody chose, so it behaves like a deadline —
    // it can arrive, and it can pass.
    expiresAt: row.dueAt,
    amount: "0",
    waitingOnThem: false,
  }));
}

/**
 * Everything Today might show, gathered from the screens that already know it.
 *
 * Gathered WIDE and filtered by `today()` rather than filtered here: the
 * closing line has to count what is waiting on other people, and the "Later
 * this week" card needs the deadlines that are deliberately NOT today. Both
 * would be unavailable if this returned only what fits on the page.
 */
export async function gather(now: Date): Promise<Item[]> {
  const [a, b, c, d, e] = await Promise.all([
    deadlines(),
    money(now),
    unanswered(),
    quick(),
    noted(),
  ]);
  return [...a, ...b, ...c, ...d, ...e];
}

export type Done = {
  entity: string;
  action: string;
  at: Date;
  screen: string | null;
};

/**
 * Screen 55's "Done today".
 *
 * From the audit log, not from a checkbox. A checkbox records that somebody
 * said they did something; the log records that the system saw it happen, and
 * on a page whose whole claim is "this is what is true right now" the second is
 * the only one worth printing.
 */
export async function doneToday(now: Date, actorId?: string): Promise<Done[]> {
  const start = new Date(now.getTime() - (now.getTime() % DAY));

  const rows = await db
    .select({
      entity: auditEntry.entity,
      action: auditEntry.action,
      at: auditEntry.at,
      screen: auditEntry.sourceScreen,
    })
    .from(auditEntry)
    .where(
      and(
        gte(auditEntry.at, start),
        actorId ? eq(auditEntry.actorId, actorId) : sql`true`,
        // What a person did. Anything the system did on its own belongs on the
        // audit log, not on a page that says "look what you got done".
        eq(auditEntry.actorKind, "user"),
      ),
    )
    .orderBy(desc(auditEntry.at))
    .limit(8);

  return rows;
}
