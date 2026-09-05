import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  time,
} from "drizzle-orm/pg-core";

/**
 * Screen 81. The interface follows the PERSON. This table is where LAW 4's first
 * axis actually lives — without it the French/English mix comes straight back.
 *
 * ONE COLUMN, and it was nine. `date_format`, `number_format`, `week_starts_on`,
 * `time_zone`, `landing_page`, `signature_fr`, `signature_en`, `away_until` and
 * `cover_user_id` were dropped on 5 September 2026: nothing wrote them, nothing
 * read them, and screen 81's own comment said so — "writes `ui_locale` and
 * nothing else".
 *
 * Each had an answer that made it unnecessary rather than unbuilt. Dates and
 * numbers are formatted from the locale, which is this column. The company is
 * in Adrar and the week starts on Sunday for all of it. Nobody has asked to
 * land somewhere other than Aujourd'hui. And a relance is DRAFTED here and sent
 * from somebody's own mail client — which already has their signature — so a
 * signature stored here would be a second one, out of date.
 *
 * Absence cover was the one with a real workflow behind it, and it is a
 * notification-routing feature nobody has designed. When it is designed, the
 * column comes back with the code that reads it. That is the rule
 * `pnpm audit:schema` exists to hold.
 */
export const userPreference = pgTable("user_preference", {
  // text, not uuid: this keys on Better Auth's `user.id`, which is a generated
  // string. Every user-scoped table below follows the same rule.
  userId: text("user_id").primaryKey(),
  uiLocale: text("ui_locale").notNull().default("fr"),
});

export const notificationPref = pgTable(
  "notification_pref",
  {
    userId: text("user_id").notNull(),
    event: text("event").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean("email").notNull().default(false),
    quietFrom: time("quiet_from"),
    quietTo: time("quiet_to"),
    digestAt: time("digest_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.event] })],
);

/*
  THERE WAS A `saved_view` TABLE HERE, and screen 79's saved views are built
  without it.

  `SavedViews` renders them, `DataTable` takes them, and the deals list defines
  two — "Closing this week", "Nothing sent yet" — in code, with translated names
  because they ship with the app. What no screen offers is SAVING one: nothing
  ever wrote this table or read it, so its nine columns described a feature that
  exists in a different shape.

  Dropped 5 September 2026. It comes back the day a list has a "save this
  question" control, together with the code that writes it — which is the rule
  `pnpm audit:schema` holds: wired up or dropped. LAW 4 note for that day: a
  view a person types keeps the language they typed it in and is never
  auto-translated, which is why the seeded two carry keys and a saved one would
  carry a name.
*/

export const tablePreference = pgTable(
  "table_preference",
  {
    userId: text("user_id").notNull(),
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
