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
  nationalId: text("national_id"),
  wilaya: text("wilaya"),
  source: text("source").notNull(), // cv | direct | subcontractor | import
  relationship: text("relationship").notNull(), // employee|temporary|daily|subcontractor|external
  employerPartyId: uuid("employer_party_id").references(() => party.id), // null = SUPSERV
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
