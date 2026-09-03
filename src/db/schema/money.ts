import {
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { document } from "./document";
import { party } from "./party";

/**
 * Screens 19 and 20 — money in.
 *
 * The shape that matters: A PAYMENT IS NOT AN INVOICE FIELD. One transfer from
 * URBACON settles three invoices; one invoice is settled by a deposit and a
 * balance two months later. Putting `paid_amount` on the document makes both of
 * those a lie, and makes the bank reconciliation impossible — there is one
 * line on the statement and it has to match one row here.
 *
 * So: a payment is a thing that happened at the bank, and its allocation across
 * invoices is a separate, editable decision. Screen 19 is where somebody moves
 * an allocation when the client says "no, that transfer was for the other one".
 */
export const payment = pgTable("payment", {
  id: uuid("id").primaryKey().defaultRandom(),

  partyId: uuid("party_id")
    .notNull()
    .references(() => party.id),

  /**
   * Which way the money went. `in` is a client paying us; `out` is us paying a
   * supplier, allocated against their invoice (kind `supplier_invoice`) the
   * same way. One table, because a bank statement is one list — and screen 19
   * filters on this rather than on which kind of invoice the allocation hit.
   */
  direction: text("direction").notNull().default("in"),

  /** virement | cheque | especes | traite | compensation */
  method: text("method").notNull(),

  /** What arrived, in the currency it arrived in. */
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("DZD"),

  /** The day the money moved, not the day somebody typed it in. */
  receivedOn: date("received_on").notNull(),

  /**
   * The bank's own reference — the virement number, the cheque number. This is
   * how a row here is matched to a line on the statement, so it is kept
   * verbatim and never tidied.
   */
  bankRef: text("bank_ref"),
  /** Which of our accounts it landed in. */
  bankAccountId: uuid("bank_account_id"),

  note: text("note"),

  recordedBy: text("recorded_by"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),

  /** Screen 83 — the bin, same as everywhere. A payment is never hard-deleted. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
  deleteReason: text("delete_reason"),
});

/**
 * How much of one payment settles one invoice.
 *
 * The sum of a payment's allocations may be LESS than the payment — a client
 * overpays, or pays an advance against nothing in particular, and the remainder
 * sits unallocated until somebody decides where it goes. That remainder is a
 * real thing the business has (money it holds and owes back or against), and
 * `unallocated()` computes it rather than hiding it.
 *
 * It may never be MORE. That is a constraint, because allocating 600 000 of a
 * 500 000 transfer makes two invoices look settled with money that never
 * arrived.
 */
export const paymentAllocation = pgTable(
  "payment_allocation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payment.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id),
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  },
  (t) => [uniqueIndex("payment_allocation_once").on(t.paymentId, t.documentId)],
);

/**
 * Screen 20's relance policy — "set in Settings".
 *
 * Data, not code, and each step names whether it needs a person. The policy
 * computes WHAT IS DUE; it never sends anything. Screen 20 says it plainly:
 * "The policy fires the reminders; a person still approves anything that
 * escalates."
 *
 * `mise en demeure` is a formal legal notice under Algerian commercial practice
 * and the first step towards court. It carries `needsApproval` and always will
 * — an automated system sending one to a client of fifteen years over a
 * fortnight's delay would cost more than the invoice.
 */
export const relanceStep = pgTable("relance_step", {
  key: text("key").primaryKey(), // reminder1 | reminder2 | phone | mise_en_demeure | stop_offers
  /** Days after the DUE DATE this step becomes due. */
  afterDueDays: integer("after_due_days").notNull(),
  /** email | phone | letter | block */
  channel: text("channel").notNull(),
  /** Nothing leaves the building on this step without a person pressing send. */
  needsApproval: boolean("needs_approval").notNull().default(false),
  position: integer("position").notNull(),
  enabled: boolean("enabled").notNull().default(true),
});

/**
 * One chase, against one invoice. Screen 20's relance history.
 *
 * "Every relance is recorded against the invoice, so 'we already chased them'
 * stops being a memory and becomes a record." That sentence is the whole table.
 * Without it, the answer to "have we chased URBACON?" is whatever the last
 * person to think about it remembers, and two people chase the same client in
 * the same week while a different one is left for four months.
 *
 * A phone call is a relance. So is a letter. The channel matters for what it
 * proves later — a mise en demeure has to be provable, an email does not — but
 * all of them count as having chased.
 */
export const relance = pgTable("relance", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => document.id, { onDelete: "cascade" }),

  /** Which policy step this was, when it came from one. Null for an ad-hoc chase. */
  stepKey: text("step_key"),
  /** email | phone | letter */
  channel: text("channel").notNull(),

  /**
   * draft | sent | delivered | replied | failed.
   *
   * `draft` is a first-class state and the reason this table exists rather than
   * a `last_chased_at` column: screen 20 shows a mise en demeure prepared and
   * "not sent — awaiting your approval". Something written and not sent is a
   * different fact from something never written.
   */
  status: text("status").notNull().default("draft"),

  /** Who it went to. Kept even if the contact is later edited or removed. */
  sentTo: text("sent_to"),
  sentAt: timestamp("sent_at", { withTimezone: true }),

  /** What came back, verbatim — "en cours de traitement", "paiement semaine du 11". */
  reply: text("reply"),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  /** A date the client promised. A promise is not a payment; it is a fact about
   *  what they said, and screen 20 shows both. */
  promisedOn: date("promised_on"),

  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
