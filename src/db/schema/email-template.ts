import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Screen 59 — Email templates and snippets.
 *
 * Deliberately NOT versioned, unlike `document_template`.
 *
 * A document template is versioned because an issued document points at the row
 * that produced it, and that row must never change again. Nothing points at an
 * email template: it produces text a person reads, edits and sends from Outlook
 * under their own name. Versioning it would be ceremony protecting nothing.
 * Editing writes an audit entry instead, which is what actually answers "who
 * changed the relance wording and when".
 *
 * `body` holds placeholders in `{group.field}` form. The vocabulary is declared
 * in `src/domain/email/placeholders.ts` and is closed — the renderer knows a
 * fixed list of names and substitutes nothing else. That is the same rule
 * `routing_rule` follows: a template edited from a settings screen must never
 * be able to become an expression that gets evaluated.
 */
export const emailTemplate = pgTable(
  "email_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** enquiryAck | offerCovering | relance1 | … — see SEED_EMAIL_TEMPLATES. */
    key: text("key").notNull(),

    /**
     * LAW 4 — the language of the COUNTERPARTY, not of the person writing.
     * A Gérant working in French sends an English covering note to an English
     * supplier, and picks the template by the supplier's language.
     */
    locale: text("locale").notNull(),

    /**
     * `template` is a whole email and has a subject. `snippet` is a paragraph
     * to paste into one and does not. Keeping them in one table is what makes
     * the placeholder vocabulary and the renderer the same for both.
     */
    scope: text("scope").notNull().default("template"),

    subject: text("subject"),
    body: text("body").notNull().default(""),

    /**
     * A seeded row nobody has written yet. It exists so the screen can list the
     * emails this company sends — an empty one is a to-do, an absent one is
     * invisible. `hasBeenWritten` in the domain is derived from the body, not
     * from this column; this records whether a PERSON has touched it.
     */
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),

    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("email_template_key_locale").on(t.key, t.locale)],
);
