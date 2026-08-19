import {
  boolean, date, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uuid,
} from "drizzle-orm/pg-core";
import { item } from "./item";
import { party } from "./party";

export const numberingSeries = pgTable("numbering_series", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  pattern: text("pattern").notNull(), // SUP/{YYYY}/{####}
  reset: text("reset").notNull().default("yearly"),
  nextValue: integer("next_value").notNull().default(1),
  /** LAW 5 — a number is allocated at ISSUE. Never on a draft. */
  reserveOn: text("reserve_on").notNull().default("issue"),
});

/**
 * One table, nineteen kinds. Everything SUPSERV issues or receives that has a
 * counterparty, a number and lines goes here — and one engine renders all of it.
 */
export const document = pgTable("document", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  /** null until issued. LAW 5. */
  number: text("number"),
  seriesId: uuid("series_id").references(() => numberingSeries.id),
  partyId: uuid("party_id").notNull().references(() => party.id),
  /** LAW 4 — resolved from party.docLocale at creation, overridable per document. */
  locale: text("locale").notNull(),
  currency: text("currency").notNull().default("DZD"),
  fxRate: numeric("fx_rate", { precision: 14, scale: 6 }),

  issuedOn: date("issued_on"),
  dueOn: date("due_on"),
  validDays: integer("valid_days"),

  /** draft | issued | part_paid | paid | credited | written_off.
   *  NOT overdue — that is computed. See LAW 1 and src/domain/state.ts. */
  status: text("status").notNull().default("draft"),

  globalDiscountPct: numeric("global_discount_pct", { precision: 6, scale: 3 }).default("0"),
  advanceDeducted: numeric("advance_deducted", { precision: 16, scale: 2 }).default("0"),
  retentionPct: numeric("retention_pct", { precision: 6, scale: 3 }).default("0"),
  stampDuty: numeric("stamp_duty", { precision: 16, scale: 2 }).default("0"),

  /** Computed by src/domain/money.ts, then frozen at issue. */
  totals: jsonb("totals").notNull(),

  /** LAW 5 — set at issue. Immutable from then on. Correction is a new document. */
  lockedAt: timestamp("locked_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentLine = pgTable("document_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => document.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  lineKind: text("line_kind").notNull(), // item | section | text | subtotal | page_break
  /** An option is shown but excluded from the totals. */
  isOption: boolean("is_option").notNull().default(false),

  itemId: uuid("item_id").references(() => item.id),
  reference: text("reference"),
  designation: text("designation"),
  note: text("note"),
  /** Screen 75 — whose name we printed, so the choice is auditable later. */
  designationSource: text("designation_source"), // client|supplier|manufacturer|internal

  unit: text("unit"),
  qty: numeric("qty", { precision: 16, scale: 4 }),
  unitPrice: numeric("unit_price", { precision: 16, scale: 4 }),
  discountPct: numeric("discount_pct", { precision: 6, scale: 3 }).default("0"),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }), // 19.00 | 9.00 | 0.00
  /** When VAT is 0, the exemption must name its article. */
  vatExemptRef: text("vat_exempt_ref"),
  totalExcl: numeric("total_excl", { precision: 16, scale: 2 }),
});

export const documentLink = pgTable(
  "document_link",
  {
    fromDocument: uuid("from_document").notNull().references(() => document.id),
    toDocument: uuid("to_document").notNull().references(() => document.id),
    /** A proforma may NEVER carry `settles`. Enforced by trigger. */
    relation: text("relation").notNull(), // converted_to | covers | credits | settles
  },
  (t) => [primaryKey({ columns: [t.fromDocument, t.toDocument, t.relation] })],
);
