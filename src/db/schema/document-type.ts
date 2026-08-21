import { boolean, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";

/**
 * Screen 50 — Document types and numbering.
 *
 * "These are the document types used across the Algerian market, not one
 * client's way of working. A client that wants something different gets a
 * template, never a new structure."
 *
 * PLAN §3.3 says one document table, nineteen kinds. This is the list of those
 * kinds and what each one IS — its legal weight, whether it takes a number of
 * ours or carries the client's, and what it can become. It deliberately does
 * NOT hold the pattern or the counter: `numbering_series` owns those, because
 * the counter has to be locked and incremented inside the issuing transaction
 * and a second copy of the pattern is a second answer to what the next number
 * is.
 */
export const documentType = pgTable("document_type", {
  /** Matches `document.kind`. */
  kind: text("kind").primaryKey(),

  /** sell | buy | internal | correspondence — the four families. */
  family: text("family").notNull(),

  /**
   * How much weight the document carries, which is the thing that decides how
   * carefully everything else has to treat it:
   *   accounting     — the tax authority's document. Immutable, credit note only.
   *   contractual    — signed by both sides. PV de réception.
   *   commitment     — binds whoever issued it. A purchase order.
   *   proof          — evidences that something happened. A delivery note.
   *   evidence       — supports a claim. A service report.
   *   information    — a statement of account.
   *   internal       — never leaves the company.
   *   declaration    — an attestation.
   *   correspondence — a letter.
   *   none           — a quotation, a proforma. No legal value at all.
   */
  legalValue: text("legal_value").notNull(),

  /**
   * onIssue         — a number from our series, taken when it is issued.
   * reservedOnIssue — the same, but the series is one nobody may have a gap in.
   * clientReference — the number is the CLIENT's. We never generate one.
   */
  numbering: text("numbering").notNull(),

  /** Kinds this one can become. A credit note becomes nothing. */
  convertsTo: jsonb("converts_to").$type<string[]>().notNull().default([]),

  /** Which document languages this kind is ever written in. */
  languages: jsonb("languages").$type<string[]>().notNull().default([]),

  /** Off means the kind exists in the market but not in this company's work. */
  active: boolean("active").notNull().default(true),

  /** Display order on screen 50. */
  position: integer("position").notNull().default(0),
});
