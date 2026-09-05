import { date, numeric, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * One table for every organisation we deal with. A company that is both a client
 * and a supplier is normal here — roles are additive, not exclusive.
 */
export const party = pgTable("party", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(), // CL-0001, SU-0011
  legalName: text("legal_name").notNull(),
  tradeName: text("trade_name"),

  // décret 05-468 — an invoice cannot be issued without these
  nif: text("nif"),
  nis: text("nis"),
  rc: text("rc"),
  ai: text("ai"),

  // Screen 84 detects duplicates by email domain and by phone, and shows both
  // field-by-field. Neither existed in the schema until that screen was read.
  email: text("email"),
  phone: text("phone"),

  address: text("address"),
  wilaya: text("wilaya"),
  country: text("country").default("DZ").notNull(),

  // LAW 4 — documents follow the counterparty, not the person typing
  docLocale: text("doc_locale").notNull().default("fr"),
  emailLocale: text("email_locale").notNull().default("fr"),

  currency: text("currency").notNull().default("DZD"),
  paymentTerms: text("payment_terms"),

  // merge (screen 84): retired, never removed. Old links still resolve.
  supersededBy: uuid("superseded_by"),

  // archive is not delete (screen 83)
  archivedAt: timestamp("archived_at", { withTimezone: true }),

  // soft delete only — 30-day bin
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
  deleteReason: text("delete_reason"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Screen 82: one company, many spellings. TOUATGAZ / Touat Gaz / TouatGaz JV / GTG
 * must all find the same record, or half of search is useless.
 */
export const partyAlias = pgTable(
  "party_alias",
  {
    partyId: uuid("party_id")
      .notNull()
      .references(() => party.id),
    alias: text("alias").notNull(),
    source: text("source"), // typed | email | import | merge
  },
  (t) => [primaryKey({ columns: [t.partyId, t.alias] })],
);

export const partyRole = pgTable(
  "party_role",
  {
    partyId: uuid("party_id")
      .notNull()
      .references(() => party.id),
    role: text("role").notNull(), // client|supplier|authority|subcontractor|partner|prospect
  },
  (t) => [primaryKey({ columns: [t.partyId, t.role] })],
);

/**
 * A person exists in their own right. A CV is an optional attachment, never the
 * reason the person exists — a crew member on a site may have no CV at all.
 */
export const person = pgTable("person", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  trade: text("trade").notNull(), // the only other required field
  phone: text("phone"),
  /** Screen 84: a discarded company email becomes a contact, not a deletion. */
  email: text("email"),
  nationalId: text("national_id"),
  wilaya: text("wilaya"),
  source: text("source").notNull(), // cv | direct | subcontractor | import
  /**
   * candidate|employee|temporary|daily|subcontractor|external.
   *
   * THIS COLUMN, not `employer_party_id`, is what separates screen 51 from
   * screen 76. A subcontractor's welder has an employer and belongs to People;
   * a buyer at a client company has an employer and belongs to Contacts. Only
   * `external` is a contact. Everything else is somebody who can be put on a
   * project.
   */
  relationship: text("relationship").notNull(),
  employerPartyId: uuid("employer_party_id").references(() => party.id), // null = SUPSERV
  /** Screen 51 — optional, and only ever meaningful for daily and temporary. */
  dailyRate: numeric("daily_rate", { precision: 16, scale: 2 }),

  /**
   * Screen 76 — how to reach this person, and whether we actually can.
   *
   * LAW 1 — these are four facts, not a status. "Active", "Unverified" and
   * "Bouncing" are computed from them in src/domain/contact.ts, because a
   * stored status is a status somebody forgets to update: the day a bounce
   * comes back, `bounced_at` is written and every screen is right at once.
   */
  prefers: text("prefers"), // email | phone | whatsapp | null = we do not know
  /** When the address or number was last confirmed to reach this person. */
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  /** When mail to this address last came back. Cleared when it is fixed. */
  bouncedAt: timestamp("bounced_at", { withTimezone: true }),
  /** Last time anybody here actually spoke to or wrote to them. */
  lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
  /**
   * RECRUITMENT — screens 24 and 25, and null for everybody who did not arrive
   * as a candidate.
   *
   * They are here rather than in a `candidate` table because screen 24's own
   * breadcrumb reads "People / Candidates": it is a view of this list. A
   * candidate who is hired keeps their row, their trade, their phone number and
   * every certification already attached to them, and changes `relationship`
   * from `candidate` to `employee`. A second table would have meant copying a
   * person across on the day they were hired, which is the day the two copies
   * start to drift.
   *
   * `stage` is the recruitment pipeline: new | reviewing | shortlisted |
   * interview | hired | archived. It is deliberately NOT the stage on a
   * personnel request — the same welder can be confirmed on one site and merely
   * shortlisted for another, and `personnel_candidate.stage` holds that.
   */
  stage: text("stage"),
  /** What they applied for, in their words. Rarely the same as `trade`. */
  appliedFor: text("applied_for"),
  /**
   * Where they will travel. "Adrar only", "Toutes wilayas", "Ouargla, sud".
   *
   * Free text, and it stays free text: a welder who will go anywhere south of
   * Ghardaïa but not to In Salah in July has said something an enum cannot
   * hold, and a system that rounded it to "mobile" would send him.
   */
  mobility: text("mobility"),

  supersededBy: uuid("superseded_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
  deleteReason: text("delete_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A man's tickets — habilitation électrique B1V, soudage arc, permis CACES.
 *
 * The substance of screen 25 and the reason screen 16's crew panel can say
 * whether somebody may work tomorrow. Two facts, and they are separate:
 * what the paper SAYS, and whether anybody has looked at the original.
 */
export const personCertification = pgTable("person_certification", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id")
    .notNull()
    .references(() => person.id),
  kind: text("kind").notNull(),
  number: text("number"),
  issuedBy: text("issued_by"),
  issuedOn: date("issued_on"),
  expiresOn: date("expires_on"),

  /**
   * WHO CHECKED IT, AND WHEN — not a boolean.
   *
   * This was `is_verified boolean not null default false`, and every screen in
   * the ERP showed "Non contrôlée" for ever, because nothing anywhere could
   * set it. LAW 2: a fact needs a confirmer, and "checked" is exactly the kind
   * of claim that needs one — a photocopy somebody filed is not a ticket
   * anybody has seen, and the site that turns a man away does not care which
   * of the two it was. Verified is computed: `verifiedAt !== null`.
   */
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),

  /** Who typed the ticket in, and when. */
  recordedBy: text("recorded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
