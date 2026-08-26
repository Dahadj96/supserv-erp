import {
  boolean,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { deal, dealLine } from "./deal";
import { party, person } from "./party";

/**
 * Screens 09, 10 and 67 — asking suppliers.
 *
 * One request goes to several suppliers at once. Each of them is a row in
 * `sourcing_response`, and the row exists from the moment the message is sent —
 * not from the moment somebody replies. That is the whole point: the screen
 * shows four suppliers asked and two replied, and the two who did not are the
 * ones worth chasing. A table that only holds replies cannot show a silence.
 */
export const sourcingRequest = pgTable("sourcing_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** SR-2026-0018. Ours, allocated on creation — not a document (LAW 5). */
  ref: text("ref").notNull().unique(),

  dealId: uuid("deal_id")
    .notNull()
    .references(() => deal.id, { onDelete: "cascade" }),

  subject: text("subject").notNull(),

  /** Null until the messages actually go out. `sentAt` is what "asked" means. */
  sentAt: timestamp("sent_at", { withTimezone: true }),

  /**
   * When we asked them to reply by.
   *
   * Screen 67 shows the gap between this and the CLIENT's deadline as "Buffer",
   * and that gap is the number that decides whether a late supplier is an
   * inconvenience or a lost bid. It is stored because it is a promise we made,
   * not a calculation.
   */
  replyBy: timestamp("reply_by", { withTimezone: true }),

  /** The lines we asked about. A request may deliberately exclude some. */
  excludedLineIds: text("excluded_line_ids").array(),

  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One supplier, on one request.
 *
 * The status list is the interesting part, and `bounced` is why it is a list
 * rather than a boolean. Screen 67 says it plainly: "A bounced address is not a
 * slow supplier — it is a broken record. Techno Fluides has never replied
 * because the message never arrived."
 *
 * Chasing a bounced address forever is how a supplier quietly drops out of
 * every comparison for a year. The two look identical in a reply-rate column
 * and mean completely different things, so they are different values and the
 * screen counts them apart.
 */
export const sourcingResponse = pgTable(
  "sourcing_response",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => sourcingRequest.id, { onDelete: "cascade" }),
    partyId: uuid("party_id")
      .notNull()
      .references(() => party.id),
    /** Who we wrote to, when we know. */
    personId: uuid("person_id").references(() => person.id),
    /** The address the message went to — kept even after a contact is edited. */
    sentTo: text("sent_to"),

    /** asked | quoted | declined | no_reply | bounced */
    status: text("status").notNull().default("asked"),

    receivedAt: timestamp("received_at", { withTimezone: true }),

    /**
     * How long the supplier holds their prices, in days. Compared against what
     * the CLIENT requires — that comparison is the first conflict on screen 67
     * and the one that costs the most when it is missed.
     */
    validityDays: integer("validity_days"),
    /** Days from order to delivery, as the supplier states them. */
    leadTimeDays: integer("lead_time_days"),

    currency: text("currency").notNull().default("DZD"),
    /** Whether their prices are before VAT. Asked, never assumed. */
    isExclVat: boolean("is_excl_vat").notNull().default(true),

    /** Free text they wrote back. Kept verbatim. */
    note: text("note"),

    /** How many times we have chased. Screen 67's "Chase 2" button. */
    chasedCount: integer("chased_count").notNull().default(0),
    lastChasedAt: timestamp("last_chased_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("sourcing_response_one_per_supplier").on(t.requestId, t.partyId)],
);

/**
 * What one supplier quoted for one line.
 *
 * Separate from `price_quote` on purpose, and the difference is worth stating:
 * `price_quote` is a price we HOLD, from wherever we found it — a counter, a
 * phone call, a proforma. This is a price a supplier gave in answer to a
 * specific question, and it carries that question's context. Confirming a
 * comparison copies the chosen ones across into `price_quote`, where the offer
 * builder reads them.
 */
export const sourcingLine = pgTable(
  "sourcing_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    responseId: uuid("response_id")
      .notNull()
      .references(() => sourcingResponse.id, { onDelete: "cascade" }),
    dealLineId: uuid("deal_line_id")
      .notNull()
      .references(() => dealLine.id, { onDelete: "cascade" }),

    /** Null means "no price for this line" — a real answer, not a missing row. */
    unitPrice: numeric("unit_price", { precision: 16, scale: 4 }),
    /** What the supplier called it, when they renamed it. Screen 75's problem. */
    theirDesignation: text("their_designation"),
    /** Their own reference for it. */
    theirReference: text("their_reference"),
    note: text("note"),
  },
  (t) => [uniqueIndex("sourcing_line_one_per_line").on(t.responseId, t.dealLineId)],
);
