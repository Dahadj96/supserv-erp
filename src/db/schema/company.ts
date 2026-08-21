import { boolean, date, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Screen 85 — Day one. "What the system will not invent for you."
 *
 * "RC, NIF, NIS and the article d'imposition are typed once, by you, and
 * checked against the paper. Nothing else in the system can be trusted if these
 * are wrong."
 *
 * One row. `id` is fixed so there can only ever be one, and so every query can
 * find it without wondering which.
 */
export const COMPANY_ID = "00000000-0000-0000-0000-000000000001";

export const companyIdentity = pgTable("company_identity", {
  id: uuid("id").primaryKey(),

  legalName: text("legal_name").notNull(),
  tradeName: text("trade_name"),
  legalForm: text("legal_form"), // SARL, EURL, SPA
  capital: numeric("capital", { precision: 16, scale: 2 }),

  /** décret 05-468 — an invoice cannot be issued without all four. */
  rc: text("rc"),
  nif: text("nif"),
  nis: text("nis"),
  ai: text("ai"), // article d'imposition

  address: text("address"),
  wilaya: text("wilaya"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),

  /** Screen 85: "Change the logo in one place and all eighteen templates change." */
  logoPath: text("logo_path"),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

/**
 * Screen 85, the blue panel: "19% and 9% are today's figures, entered as rules
 * with a start date. When they change you add a new rate rather than editing
 * the old one, so last year's invoices still recompute correctly."
 *
 * That sentence is the entire reason this is a table and not two columns. A VAT
 * rate edited in place silently rewrites the past, and LAW 5 says an issued
 * document is immutable — including the arithmetic inside it.
 */
export const vatRate = pgTable("vat_rate", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 19.000, 9.000, 0.000 */
  rate: numeric("rate", { precision: 6, scale: 3 }).notNull(),
  /** normal | reduced | exempt — what a line picks, not what it costs. */
  kind: text("kind").notNull(),
  /** The day this rate started applying. Never null. */
  startsOn: date("starts_on").notNull(),
  /** Null = still in force. Set when a successor starts. */
  endsOn: date("ends_on"),
  /** "loi de finances 2017" — a rate with no authority is somebody's memory. */
  authority: text("authority"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Screen 85, step 5 — "Printed on the invoice as the domiciliation."
 *
 * An Algerian invoice carries the bank and the RIB it should be paid into. More
 * than one account is normal; exactly one is the default.
 */
export const bankAccount = pgTable("bank_account", {
  id: uuid("id").primaryKey().defaultRandom(),
  bankName: text("bank_name").notNull(),
  agency: text("agency"),
  /** 20 digits, the Algerian bank identifier printed on the invoice. */
  rib: text("rib").notNull(),
  iban: text("iban"),
  swift: text("swift"),
  currency: text("currency").notNull().default("DZD"),
  isDefault: boolean("is_default").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});
