import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Screen 71 — Document templates.
 *
 * "A template holds layout and wording. It never holds your address, RC, NIF,
 * bank details or logo — those are read from company master data at render
 * time. Change the logo once and all eighteen change."
 *
 * So this table is deliberately small. Eleven blocks make up a document and
 * nine of them come from master data; only two are the template's own — the
 * wording and section order, and the footer mentions it adds to whatever the
 * compliance profile already requires.
 */
export const documentTemplate = pgTable("document_template", {
  id: uuid("id").primaryKey().defaultRandom(),

  /** Matches `document_type.kind`. */
  kind: text("kind").notNull(),
  /** The document language this wording is written in. LAW 4. */
  locale: text("locale").notNull(),

  /**
   * Bumped when the wording changes. An issued document stores the version that
   * produced it, so reprinting a 2026 invoice in 2029 gives back the 2026
   * document rather than today's layout.
   */
  version: integer("version").notNull().default(1),

  /**
   * The two things a template actually decides. Kept as one document rather
   * than a column each, because the set of wording slots differs by kind — a
   * delivery note has no "arrêtée à la somme de" line and a quotation has a
   * validity sentence that no invoice has.
   */
  wording: jsonb("wording").$type<Record<string, string>>().notNull().default({}),

  /** Extra mentions this template prints beneath the compliance ones. */
  footerMentions: jsonb("footer_mentions").$type<string[]>().notNull().default([]),

  /** Off means it exists but is not offered. Superseded versions go off. */
  active: boolean("active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
