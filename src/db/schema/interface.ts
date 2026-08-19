import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  time,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Screen 81. The interface follows the PERSON. This table is where LAW 4's first
 * axis actually lives — without it the French/English mix comes straight back.
 */
export const userPreference = pgTable("user_preference", {
  userId: uuid("user_id").primaryKey(),
  uiLocale: text("ui_locale").notNull().default("fr"),
  dateFormat: text("date_format").default("dd/MM/yyyy"),
  numberFormat: text("number_format").default("fr-DZ"),
  weekStartsOn: integer("week_starts_on").default(0), // Sunday — the working week in Algeria
  timeZone: text("time_zone").default("Africa/Algiers"),
  landingPage: text("landing_page").default("today"),
  /** The signature follows the EMAIL's language, not the person's interface. */
  signatureFr: text("signature_fr"),
  signatureEn: text("signature_en"),
  awayUntil: date("away_until"),
  coverUserId: uuid("cover_user_id"),
});

export const notificationPref = pgTable(
  "notification_pref",
  {
    userId: uuid("user_id").notNull(),
    event: text("event").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean("email").notNull().default(false),
    quietFrom: time("quiet_from"),
    quietTo: time("quiet_to"),
    digestAt: time("digest_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.event] })],
);

/** Screen 79 — a saved view is a named question, not a query. */
export const savedView = pgTable("saved_view", {
  id: uuid("id").primaryKey().defaultRandom(),
  entity: text("entity").notNull(),
  name: text("name").notNull(),
  filter: jsonb("filter").notNull(),
  sort: jsonb("sort"),
  columns: jsonb("columns"),
  ownerId: uuid("owner_id"),
  shared: boolean("shared").notNull().default(false),
  isDefaultFor: uuid("is_default_for"),
});

export const tablePreference = pgTable(
  "table_preference",
  {
    userId: uuid("user_id").notNull(),
    entity: text("entity").notNull(),
    columns: jsonb("columns"),
    sort: jsonb("sort"),
    pageSize: integer("page_size").default(25),
  },
  (t) => [primaryKey({ columns: [t.userId, t.entity] })],
);

/**
 * Screen 80 + 69. THE table that makes "no grey button without a reason" true.
 * A rule with confirmedBy = null WARNS. It does not block. The system never
 * asserts a law on its own authority.
 */
export const blockingRule = pgTable("blocking_rule", {
  code: text("code").primaryKey(), // invoice.client_nif_missing
  appliesTo: text("applies_to").notNull(), // invoice.issue
  messageKey: text("message_key").notNull(), // i18n key, both languages
  authority: text("authority"), // "décret 05-468" | "company policy"
  confirmedBy: text("confirmed_by"),
  confirmedOn: date("confirmed_on"),
  fixRoute: text("fix_route"), // where the "fix this" button goes
});
