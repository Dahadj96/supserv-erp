import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { party, person } from "./party";

/**
 * Screen 38 — every way work reaches SUPSERV.
 *
 * The channel list is data, not code, for one reason: the screen shows channels
 * that are NOT built and NOT connected, with a count of what is being lost
 * through them. "The portal and paper channels have no path into the system.
 * Anything arriving that way exists only in somebody's memory until it is typed
 * in by hand." A channel you cannot see is a channel nobody fixes.
 */
export const intakeChannel = pgTable("intake_channel", {
  key: text("key").primaryKey(), // mailbox | manual | upload | portal_urbacon | scan | ...
  /** live | not_connected | not_built | considered */
  status: text("status").notNull().default("not_built"),
  /** Whether classification runs on what arrives here. */
  autoClassify: boolean("auto_classify").notNull().default(false),
  /** Free config per channel — the mailbox address, the portal URL. */
  config: jsonb("config"),
  /** Set by whatever last captured through this channel. Never by hand. */
  lastReceivedAt: timestamp("last_received_at", { withTimezone: true }),
  position: integer("position").notNull().default(0),
});

/**
 * Screen 38 — applied in order, first match wins.
 *
 * The matcher is structured JSON, never an expression to evaluate. A rule
 * engine that runs arbitrary strings from the database is a way to execute code
 * by editing a row, and this table is edited from a settings screen.
 */
export const routingRule = pgTable("routing_rule", {
  id: uuid("id").primaryKey().defaultRandom(),
  position: integer("position").notNull(),
  /** What it does when it matches — see src/domain/intake/routing.ts. */
  matcher: jsonb("matcher").notNull(),
  creates: text("creates").notNull(), // candidate|enquiry|tender|supplier_quote|payment|needs_review
  /** auto | suggest | manual. Never auto below the confidence floor. */
  mode: text("mode").notNull().default("manual"),
  enabled: boolean("enabled").notNull().default(true),
  /** i18n key for the sentence the screen prints. Never a literal. */
  labelKey: text("label_key").notNull(),
  actionKey: text("action_key").notNull(),
});

/**
 * One captured thing, whatever channel it came through. An email, an uploaded
 * file, a scanned dossier, a note somebody typed after a phone call.
 *
 * LAW 2 — nothing here is a fact. This table is what arrived; the records it
 * becomes are created only after a person confirms them (screen 40).
 */
export const intakeMessage = pgTable("intake_message", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelKey: text("channel_key")
    .notNull()
    .references(() => intakeChannel.key),

  /** The id in the system it came from — a Graph message id. Unique per channel. */
  externalId: text("external_id"),

  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  fromAddress: text("from_address"),
  fromName: text("from_name"),
  subject: text("subject"),
  /** The body as text. The original stays in the mailbox — see the safety rails. */
  bodyText: text("body_text"),

  /** Who it appears to be from, once matched. Null until somebody or something matches it. */
  partyId: uuid("party_id").references(() => party.id),
  personId: uuid("person_id").references(() => person.id),

  /**
   * needs_review | classified | committed | archived | ignored.
   *
   * `committed` means a record was created from it. `archived` means it was
   * dealt with and needs nothing. Neither is a delete — screen 83 applies here
   * too, and an email nobody can find again is worse than one nobody read.
   */
  status: text("status").notNull().default("needs_review"),

  /** What the router thinks it is, and how sure. Both null until it has run. */
  classifiedAs: text("classified_as"),
  confidence: numeric("confidence", { precision: 4, scale: 3 }),
  matchedRuleId: uuid("matched_rule_id").references(() => routingRule.id),

  /** Set when a record was created from this. What it became, and which one. */
  committedEntity: text("committed_entity"),
  committedEntityId: uuid("committed_entity_id"),
  committedAt: timestamp("committed_at", { withTimezone: true }),
  committedBy: uuid("committed_by"),

  /** Everything the channel gave us, kept verbatim for when the parse was wrong. */
  raw: jsonb("raw"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A file that arrived with a message. The bytes live in storage; this row is
 * how the system knows the file exists, and the sha256 is how it knows the same
 * attachment forwarded twice is the same attachment.
 */
export const intakeAttachment = pgTable("intake_attachment", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id")
    .notNull()
    .references(() => intakeMessage.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  contentType: text("content_type"),
  sizeBytes: integer("size_bytes"),
  /** Where the bytes are. Null while the file is still being fetched. */
  storagePath: text("storage_path"),
  sha256: text("sha256"),
  /** cv | quote | invoice | delivery_note | tender_dossier | unknown */
  looksLike: text("looks_like"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
