import { boolean, date, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
  deletedBy: uuid("deleted_by"),
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
  relationship: text("relationship").notNull(), // employee|temporary|daily|subcontractor|external
  employerPartyId: uuid("employer_party_id").references(() => party.id), // null = SUPSERV

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
  supersededBy: uuid("superseded_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: uuid("deleted_by"),
  deleteReason: text("delete_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  isVerified: boolean("is_verified").notNull().default(false),
});
