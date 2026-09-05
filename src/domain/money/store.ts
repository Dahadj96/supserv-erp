import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { document } from "@/db/schema/document";
import { payment, paymentAllocation, relance, relanceStep } from "@/db/schema/money";
import { party } from "@/db/schema/party";
import { payables } from "@/domain/purchase/store";
import { balanceOf, type Owing } from "./ageing";
import type { Received, Settlement } from "./collection";
import { DEFAULT_POLICY, type RelanceRecord, type RelanceStatus, type Step } from "./relance";

/**
 * Screens 19 and 20 — the database half.
 *
 * Nothing here stores a balance, an "overdue" flag, or a "last chased" column.
 * All three are computed from rows that record what actually happened, which is
 * what makes them impossible to get out of step with reality.
 */

export class PaymentRefused extends Error {
  constructor(
    readonly reason:
      | "noSuchPayment"
      | "noSuchInvoice"
      | "notIssued"
      | "amountNotPositive"
      | "exceedsPayment"
      | "exceedsBalance",
  ) {
    super(reason);
  }
}

const INVOICE_KINDS = ["invoice", "advance_invoice", "situation"];

/** Every unpaid invoice, with what has been allocated against it. */
export async function owings(opts: { partyId?: string } = {}): Promise<Owing[]> {
  const rows = await db
    .select({
      documentId: document.id,
      number: document.number,
      partyId: document.partyId,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      issuedOn: document.issuedOn,
      dueOn: document.dueOn,
      totals: document.totals,
      currency: document.currency,
      status: document.status,
      paid: sql<string>`coalesce((
        select sum(${paymentAllocation.amount})
        from ${paymentAllocation}
        join ${payment} on ${payment.id} = ${paymentAllocation.paymentId}
        where ${paymentAllocation.documentId} = ${document.id}
          and ${payment.deletedAt} is null
      ), 0)::text`,
      lastRelanceAt: sql<Date | null>`(
        select max(${relance.sentAt}) from ${relance}
        where ${relance.documentId} = ${document.id} and ${relance.status} <> 'draft'
      )`,
    })
    .from(document)
    .innerJoin(party, eq(party.id, document.partyId))
    .where(
      and(
        inArray(document.kind, INVOICE_KINDS),
        // Issued only. A draft invoice is not owed by anybody — the client has
        // never seen it (LAW 5).
        sql`${document.number} is not null`,
        sql`${document.status} not in ('credited', 'written_off')`,
        opts.partyId ? eq(document.partyId, opts.partyId) : sql`true`,
      ),
    );

  return rows.map((row) => {
    const totals = (row.totals ?? {}) as { totalIncl?: string; dueNow?: string };
    return {
      documentId: row.documentId,
      number: row.number,
      partyId: row.partyId,
      clientName: row.clientName,
      issuedOn: row.issuedOn ? new Date(`${row.issuedOn}T00:00:00Z`) : null,
      dueOn: row.dueOn ? new Date(`${row.dueOn}T00:00:00Z`) : null,
      totalIncl: totals.totalIncl ?? "0",
      // A situation's net à payer — see `Owing.owedNow`. On every ordinary
      // invoice this IS the TTC, so nothing about screens 19 and 20 changes
      // except that a client holding a retenue de garantie is no longer late.
      owedNow: totals.dueNow,
      paid: row.paid,
      currency: row.currency,
      lastRelanceAt: row.lastRelanceAt ? new Date(row.lastRelanceAt) : null,
    };
  });
}

/**
 * Record money arriving, and say where it goes.
 *
 * The allocation is checked against the invoice's REMAINING balance, not its
 * total. Two transfers of 3 000 000 against a 5 640 000 invoice: the second one
 * may only take 2 640 000, and offering to allocate the full 3 000 000 would
 * quietly create a credit nobody asked for.
 *
 * The database enforces the other half — allocations may not exceed the payment
 * — with a trigger, because that rule spans rows. Both are checked here first
 * so a person meets a sentence rather than a five-hundred.
 */
export async function recordPayment(opts: {
  partyId: string;
  /** `in` (default) — a client paid us. `out` — we paid a supplier. */
  direction?: "in" | "out";
  method: string;
  amount: string;
  currency?: string;
  receivedOn: string;
  bankRef?: string | null;
  note?: string | null;
  /** documentId → amount. May be empty: money can arrive before anyone knows
   *  which invoice it settles, and holding it unallocated is honest. */
  allocations?: Record<string, string>;
  actorId: string;
}): Promise<string> {
  const amount = Number(opts.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new PaymentRefused("amountNotPositive");

  const entries = Object.entries(opts.allocations ?? {}).filter(([, v]) => Number(v) > 0);
  const allocated = entries.reduce((sum, [, v]) => sum + Number(v), 0);
  if (allocated > amount + 0.005) throw new PaymentRefused("exceedsPayment");

  const direction = opts.direction ?? "in";
  if (entries.length > 0) {
    // Money in settles what clients owe us; money out settles what we owe
    // suppliers. The balance check is the same either way.
    const ledger = direction === "out" ? await payables() : await owings();
    for (const [documentId, value] of entries) {
      const invoice = ledger.find((o) => o.documentId === documentId);
      if (!invoice) throw new PaymentRefused("noSuchInvoice");
      if (Number(value) > Number(balanceOf(invoice)) + 0.005) {
        throw new PaymentRefused("exceedsBalance");
      }
    }
  }

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(payment)
      .values({
        partyId: opts.partyId,
        direction,
        method: opts.method,
        amount: opts.amount,
        currency: opts.currency || "DZD",
        receivedOn: opts.receivedOn,
        bankRef: opts.bankRef?.trim() || null,
        note: opts.note?.trim() || null,
        recordedBy: opts.actorId,
      })
      .returning({ id: payment.id });

    const id = created?.id as string;

    if (entries.length > 0) {
      await tx
        .insert(paymentAllocation)
        .values(
          entries.map(([documentId, value]) => ({ paymentId: id, documentId, amount: value })),
        );
    }

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "payment",
      entityId: id,
      action: "create",
      after: {
        partyId: opts.partyId,
        direction,
        amount: opts.amount,
        method: opts.method,
        bankRef: opts.bankRef ?? null,
        allocations: entries.length,
        // Named, because "money we hold and have not assigned" is a real
        // position and not an accident.
        unallocated: (amount - allocated).toFixed(2),
      },
      sourceScreen: "19",
    });

    return id;
  });
}

/** Money received and not yet assigned to any invoice. A real position. */
export async function unallocated(partyId?: string): Promise<string> {
  const [row] = await db
    .select({
      held: sql<string>`coalesce(sum(${payment.amount}) - coalesce((
        select sum(${paymentAllocation.amount}) from ${paymentAllocation}
        where ${paymentAllocation.paymentId} in (
          select id from ${payment} p2
          where p2.deleted_at is null and p2.direction = 'in' ${partyId ? sql`and p2.party_id = ${partyId}` : sql``}
        )
      ), 0), 0)::text`,
    })
    .from(payment)
    .where(
      and(
        isNull(payment.deletedAt),
        eq(payment.direction, "in"),
        partyId ? eq(payment.partyId, partyId) : sql`true`,
      ),
    );
  return row?.held ?? "0";
}

/** The relance policy, seeded on first read so settings has something to edit. */
export async function policy(): Promise<Step[]> {
  const rows = await db.select().from(relanceStep).orderBy(relanceStep.position);
  if (rows.length === 0) {
    await db.insert(relanceStep).values(
      DEFAULT_POLICY.map((s) => ({
        key: s.key,
        afterDueDays: s.afterDueDays,
        channel: s.channel,
        needsApproval: s.needsApproval,
        position: s.position,
        enabled: s.enabled,
      })),
    );
    return DEFAULT_POLICY;
  }
  return rows.map((r) => ({
    key: r.key as Step["key"],
    afterDueDays: r.afterDueDays,
    channel: r.channel as Step["channel"],
    needsApproval: r.needsApproval,
    position: r.position,
    enabled: r.enabled,
  }));
}

/** Every chase against one invoice, oldest first — screen 20's history card. */
export async function relancesFor(documentIds: string[]): Promise<Map<string, RelanceRecord[]>> {
  const out = new Map<string, RelanceRecord[]>();
  if (documentIds.length === 0) return out;

  const rows = await db
    .select()
    .from(relance)
    .where(inArray(relance.documentId, documentIds))
    .orderBy(relance.createdAt);

  for (const row of rows) {
    const list = out.get(row.documentId) ?? [];
    list.push({
      id: row.id,
      stepKey: row.stepKey,
      channel: row.channel,
      status: row.status as RelanceStatus,
      sentAt: row.sentAt,
      promisedOn: row.promisedOn ? new Date(`${row.promisedOn}T00:00:00Z`) : null,
    });
    out.set(row.documentId, list);
  }
  return out;
}

/**
 * Draft a chase. DRAFTS it — writes a row with status `draft` and sends
 * nothing.
 *
 * That is not a limitation to be fixed later. Screen 20: "The policy fires the
 * reminders; a person still approves anything that escalates." The system's job
 * is to know what is owed a chase and to have it written; putting it in front
 * of a client is a person's.
 */
export async function draftRelance(opts: {
  documentId: string;
  stepKey: string | null;
  channel: string;
  sentTo?: string | null;
  actorId: string;
}): Promise<string> {
  const [invoice] = await db
    .select({ id: document.id, number: document.number })
    .from(document)
    .where(eq(document.id, opts.documentId))
    .limit(1);
  if (!invoice) throw new PaymentRefused("noSuchInvoice");
  // Chasing an invoice the client has never seen is chasing nothing.
  if (!invoice.number) throw new PaymentRefused("notIssued");

  const [created] = await db
    .insert(relance)
    .values({
      documentId: opts.documentId,
      stepKey: opts.stepKey,
      channel: opts.channel,
      status: "draft",
      sentTo: opts.sentTo?.trim() || null,
      createdBy: opts.actorId,
    })
    .returning({ id: relance.id });

  const id = created?.id as string;
  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "relance",
    entityId: id,
    action: "create",
    after: { documentId: opts.documentId, stepKey: opts.stepKey, status: "draft", sent: false },
    sourceScreen: "20",
  });
  return id;
}

/**
 * A person sent it. Recorded, not performed — the message went out of somebody's
 * mail client, or they picked up a telephone.
 */
export async function markRelanceSent(opts: {
  relanceId: string;
  when?: Date;
  actorId: string;
}): Promise<void> {
  await db
    .update(relance)
    .set({ status: "sent", sentAt: opts.when ?? new Date() })
    .where(eq(relance.id, opts.relanceId));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "relance",
    entityId: opts.relanceId,
    action: "update",
    after: { status: "sent" },
    sourceScreen: "20",
  });
}

/**
 * What the client said back, and any date they promised.
 *
 * A promise is NOT a payment. It is a fact about what somebody said, it stops
 * the policy chasing again until that date, and screen 20 shows both so nobody
 * confuses the two.
 */
export async function recordReply(opts: {
  relanceId: string;
  reply: string;
  promisedOn?: string | null;
  actorId: string;
}): Promise<void> {
  await db
    .update(relance)
    .set({
      status: "replied",
      reply: opts.reply.trim() || null,
      repliedAt: new Date(),
      promisedOn: opts.promisedOn || null,
    })
    .where(eq(relance.id, opts.relanceId));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "relance",
    entityId: opts.relanceId,
    action: "update",
    after: { status: "replied", promisedOn: opts.promisedOn ?? null, paid: false },
    sourceScreen: "20",
  });
}

/** Screen 19 — payments received, newest first. */
export async function listPayments(limit = 100) {
  return db
    .select({
      id: payment.id,
      direction: payment.direction,
      amount: payment.amount,
      currency: payment.currency,
      method: payment.method,
      receivedOn: payment.receivedOn,
      bankRef: payment.bankRef,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      allocated: sql<string>`coalesce((
        select sum(${paymentAllocation.amount}) from ${paymentAllocation}
        where ${paymentAllocation.paymentId} = ${payment.id}
      ), 0)::text`,
    })
    .from(payment)
    .innerJoin(party, eq(party.id, payment.partyId))
    .where(isNull(payment.deletedAt))
    .orderBy(desc(payment.receivedOn), desc(payment.recordedAt))
    .limit(limit);
}

/**
 * Screen 19's "Recent payments" table needs to say which invoice each payment
 * settled, and one payment may settle several.
 *
 * Returned as a map rather than joined into the payment rows because a join
 * would repeat the payment on every allocation, and a table that shows one
 * transfer of 856 800 three times is a table somebody adds up wrongly.
 */
export async function allocationsFor(
  paymentIds: string[],
): Promise<Map<string, { documentId: string; number: string | null; amount: string }[]>> {
  const out = new Map<string, { documentId: string; number: string | null; amount: string }[]>();
  if (paymentIds.length === 0) return out;

  const rows = await db
    .select({
      paymentId: paymentAllocation.paymentId,
      documentId: paymentAllocation.documentId,
      number: document.number,
      amount: paymentAllocation.amount,
    })
    .from(paymentAllocation)
    .innerJoin(document, eq(document.id, paymentAllocation.documentId))
    .where(inArray(paymentAllocation.paymentId, paymentIds));

  for (const row of rows) {
    const list = out.get(row.paymentId) ?? [];
    list.push({ documentId: row.documentId, number: row.number, amount: row.amount });
    out.set(row.paymentId, list);
  }
  return out;
}

/**
 * Every issued invoice with the day it was cleared, for "average days to pay".
 *
 * `settledOn` is the arrival date of the LAST payment allocated to it, and only
 * once the allocations cover the total. Part paid is not paid: a client who
 * sends a deposit in a week and the balance in four months took four months,
 * and calling that a week would flatter the one behaviour this figure exists to
 * measure.
 *
 * Written as a join and a group by, not correlated subqueries. Drizzle renders
 * a `sql` template's table reference without correlating it, which returned 0
 * silently in `requestsForDeal` — and silently is the problem, because zero
 * days to pay reads as *they pay instantly*.
 */
export async function settlements(): Promise<Settlement[]> {
  const paid = sql<string>`coalesce(sum(
    case when ${payment.id} is not null then ${paymentAllocation.amount} else 0 end
  ), 0)::text`;

  const rows = await db
    .select({
      documentId: document.id,
      partyId: document.partyId,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      issuedOn: document.issuedOn,
      total: sql<string>`coalesce(${document.totals} ->> 'totalIncl', '0')`,
      paid,
      lastPaymentOn: sql<string | null>`max(${payment.receivedOn})`,
    })
    .from(document)
    .innerJoin(party, eq(party.id, document.partyId))
    .leftJoin(paymentAllocation, eq(paymentAllocation.documentId, document.id))
    .leftJoin(payment, and(eq(payment.id, paymentAllocation.paymentId), isNull(payment.deletedAt)))
    .where(
      and(
        inArray(document.kind, INVOICE_KINDS),
        sql`${document.number} is not null`,
        sql`${document.status} not in ('credited', 'written_off')`,
      ),
    )
    .groupBy(document.id, document.partyId, party.tradeName, party.legalName, document.issuedOn);

  return rows.map((row) => {
    const cleared = Number(row.paid) + 0.005 >= Number(row.total) && Number(row.total) > 0;
    return {
      documentId: row.documentId,
      partyId: row.partyId,
      clientName: row.clientName,
      issuedOn: row.issuedOn ? new Date(`${row.issuedOn}T00:00:00Z`) : null,
      settledOn: cleared && row.lastPaymentOn ? new Date(`${row.lastPaymentOn}T00:00:00Z`) : null,
    };
  });
}

/** Money that arrived on or after `from`. Screen 19's "quarter to date". */
export async function receivedSince(from: string): Promise<Received[]> {
  return db
    .select({ amount: payment.amount, currency: payment.currency })
    .from(payment)
    .where(
      and(
        isNull(payment.deletedAt),
        eq(payment.direction, "in"),
        sql`${payment.receivedOn} >= ${from}`,
      ),
    );
}

/**
 * Screen 17's table — every document that behaves like a bill, drafts and
 * proformas included.
 *
 * Wider than `owings()` on purpose. `owings()` answers "what is owed", so it
 * drops drafts and proformas; this answers "what have we billed", so it keeps
 * them and lets `paidStateOf` say what each one is. Two questions, two queries,
 * rather than one query with a flag and a comment explaining when to pass it.
 *
 * The Object column has no column behind it: the frame shows "Climatiseurs et
 * accessoires", which is the first line of the document. Derived, not stored —
 * a copy of the first line kept on the header is a copy that goes stale the
 * moment somebody edits the line.
 */
export type BilledRow = {
  documentId: string;
  kind: string;
  number: string | null;
  status: string;
  partyId: string;
  clientName: string;
  clientCode: string | null;
  object: string | null;
  issuedOn: Date | null;
  dueOn: Date | null;
  currency: string;
  totalIncl: string;
  /** What it asks for today — a situation's net à payer. See `Owing.owedNow`. */
  owedNow?: string;
  paid: string;
};

const BILLED_KINDS = ["invoice", "advance_invoice", "situation", "proforma", "credit_note"];

export async function billed(): Promise<BilledRow[]> {
  const rows = await db
    .select({
      documentId: document.id,
      kind: document.kind,
      number: document.number,
      status: document.status,
      partyId: document.partyId,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      clientCode: party.code,
      issuedOn: document.issuedOn,
      dueOn: document.dueOn,
      currency: document.currency,
      totals: document.totals,
      createdAt: document.createdAt,
      object: sql<string | null>`(
        select dl.designation from document_line dl
        where dl.document_id = ${document.id} and dl.line_kind = 'item'
        order by dl.position limit 1
      )`,
      paid: sql<string>`coalesce((
        select sum(pa.amount) from payment_allocation pa
        join ${payment} p on p.id = pa.payment_id
        where pa.document_id = ${document.id} and p.deleted_at is null
      ), 0)::text`,
    })
    .from(document)
    .innerJoin(party, eq(party.id, document.partyId))
    .where(inArray(document.kind, BILLED_KINDS))
    .orderBy(desc(document.createdAt));

  return rows.map((row) => {
    const totals = (row.totals ?? {}) as {
      totalIncl?: string;
      totalExcl?: string;
      dueNow?: string;
    };
    return {
      documentId: row.documentId,
      kind: row.kind,
      number: row.number,
      status: row.status,
      partyId: row.partyId,
      clientName: row.clientName,
      clientCode: row.clientCode,
      object: row.object,
      issuedOn: row.issuedOn ? new Date(`${row.issuedOn}T00:00:00Z`) : null,
      dueOn: row.dueOn ? new Date(`${row.dueOn}T00:00:00Z`) : null,
      currency: row.currency,
      totalIncl: totals.totalIncl ?? totals.totalExcl ?? "0",
      owedNow: totals.dueNow,
      paid: row.paid,
    };
  });
}
