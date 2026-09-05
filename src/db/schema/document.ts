import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { item } from "./item";
import { party } from "./party";

export const numberingSeries = pgTable("numbering_series", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  pattern: text("pattern").notNull(), // SUP/{YYYY}/{####}
  reset: text("reset").notNull().default("yearly"),
  nextValue: integer("next_value").notNull().default(1),
  /*
    There was a `reserve_on` here, `'issue'` on every row and read by nothing.
    LAW 5 is not a per-series setting: a number is allocated at ISSUE, full
    stop, and `document_type.numbering` already says which kinds take one of
    ours at all (`reservedOnIssue`) and which carry the counterparty's. A column
    offering a second answer to a question the catalogue has already answered is
    a column that can disagree with it. Dropped 5 September 2026.
  */
});

/**
 * One table, nineteen kinds. Everything SUPSERV issues or receives that has a
 * counterparty, a number and lines goes here — and one engine renders all of it.
 */
export const document = pgTable(
  "document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    /** null until issued. LAW 5. */
    number: text("number"),
    seriesId: uuid("series_id").references(() => numberingSeries.id),
    partyId: uuid("party_id")
      .notNull()
      .references(() => party.id),

    /**
     * The enquiry this document answers. Null for anything that started life
     * without one — a direct invoice, a supplier's proforma filed on its own.
     *
     * Added in phase 4 and it is what makes screen 05's derived stage possible:
     * "offer out" is not a flag somebody sets, it is `count(document) where
     * deal_id = … and number is not null`. Without this column the stage would
     * have to be stored, and a stored stage is a second opinion (see
     * src/domain/deal/stage.ts).
     *
     * No cascade: deleting an enquiry must never delete an issued invoice.
     */
    dealId: uuid("deal_id"),

    /** LAW 4 — resolved from party.docLocale at creation, overridable per document. */
    locale: text("locale").notNull(),
    currency: text("currency").notNull().default("DZD"),
    fxRate: numeric("fx_rate", { precision: 14, scale: 6 }),

    issuedOn: date("issued_on"),
    dueOn: date("due_on"),
    validDays: integer("valid_days"),

    /**
     * HOW THE DOCUMENT IS EXPECTED TO BE SETTLED — virement | cheque | especes |
     * traite | compensation, the same five words `payment.method` uses.
     *
     * "Mode de règlement" is one of the mentions décret 05-468 requires on an
     * invoice, and until this column existed the engine had nowhere to read it
     * from and printed nothing. It is also the one fact the droit de timbre
     * turns on: a sum settled in cash attracts it and a transfer does not, and
     * `saveDraft` reads this to decide — once a person has confirmed the rule.
     *
     * Nullable, because a quotation does not know yet. Frozen at issue with the
     * rest of the document.
     */
    settlement: text("settlement"),

    /**
     * WHAT THE DOCUMENT IS: draft | issued | credited | written_off.
     *
     * Not overdue, and — since phase 5 — not paid or part-paid either. Those
     * three are arithmetic over `payment_allocation` and a date, and they change
     * without anybody touching this row. Storing them here means a transition
     * somebody has to remember to fire; the first screen that forgets leaves an
     * invoice reading "issued" with its balance at nought.
     *
     * `part_paid` and `paid` still appear in rows written before that, and
     * `paidStateOf` ignores them in favour of the allocations. See LAW 1 and
     * src/domain/money/invoices.ts.
     */
    status: text("status").notNull().default("draft"),

    globalDiscountPct: numeric("global_discount_pct", { precision: 6, scale: 3 }).default("0"),
    advanceDeducted: numeric("advance_deducted", { precision: 16, scale: 2 }).default("0"),
    retentionPct: numeric("retention_pct", { precision: 6, scale: 3 }).default("0"),
    stampDuty: numeric("stamp_duty", { precision: 16, scale: 2 }).default("0"),

    /** Computed by src/domain/money.ts, then frozen at issue. */
    totals: jsonb("totals").notNull(),

    /** LAW 5 — set at issue. Immutable from then on. Correction is a new document. */
    lockedAt: timestamp("locked_at", { withTimezone: true }),

    /**
     * Screen 71: "Reprinting an invoice from 2026 in 2029 must produce the 2026
     * document, not the current layout. The version is stored on the document,
     * not looked up."
     *
     * The same is true of the company's own address, its RC, and the bank account
     * that was on the footer. Every one of those is master data that will change,
     * and every one of them is printed on a document a tax inspector may ask for
     * years later. At issue the engine freezes what it used into `renderSnapshot`
     * and never reads master data for that document again. Null on a draft, which
     * is exactly right: a draft has no promise to keep.
     */
    templateId: uuid("template_id"),
    templateVersion: integer("template_version"),
    renderSnapshot: jsonb("render_snapshot"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * LAW 5 in the database, not only in `reserveNumber`'s transaction: a
     * number of ours is never allocated twice. Partial, because a counterparty's
     * number is theirs — two clients may both send a "BC 001".
     */
    uniqueIndex("document_kind_number_once")
      .on(table.kind, table.number)
      .where(
        sql`${table.number} is not null and ${table.kind} not in ('client_order', 'supplier_invoice')`,
      ),
    // Every counterparty page and the ledger read documents by party.
    index("document_party_idx").on(table.partyId, table.kind),
    // The lists filter by kind and state before anything else.
    index("document_kind_status_idx").on(table.kind, table.status),
  ],
);

export const documentLine = pgTable(
  "document_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    lineKind: text("line_kind").notNull(), // item | section | text | subtotal | page_break
    /** An option is shown but excluded from the totals. */
    isOption: boolean("is_option").notNull().default(false),

    /**
     * The line on another document that this one delivers, invoices or answers.
     *
     * Screen 49 needs "ordered 24, already delivered 12, this delivery 12,
     * remaining 0" across three separate bons de livraison, and the only honest
     * way to add those up is for each BL line to point at the line it is
     * delivering. Matching on designation instead would collapse two lines that
     * happen to read the same and silently over-deliver one of them.
     *
     * Self-referencing and nullable: most lines are not delivering anything.
     * No cascade — deleting a draft must never touch an issued document's line.
     */
    sourceLineId: uuid("source_line_id"),

    /**
     * The ENQUIRY line this line answers. Not the same thing as `sourceLineId`
     * above, which points at another DOCUMENT line.
     *
     * Screen 42 needs it. A bordereau's forty-two lines are `deal_line` rows
     * numbered as the client numbered them — 1, 2, 3, then 5 after an erratum
     * removed 4 — while an offer's lines are numbered 1..n in their own order,
     * so position does not join the two. The alternative is matching on the
     * designation, which is the thing this codebase says is wrong everywhere
     * else: two lines that happen to read the same collapse into one.
     *
     * Deliberately no foreign key, for the reason given above `sourceLineId`:
     * deleting a draft's line must never write to an issued document's row. A
     * dangling id joins to nothing, which is the correct answer once the client
     * has removed the line it pointed at.
     */
    dealLineId: uuid("deal_line_id"),

    itemId: uuid("item_id").references(() => item.id),
    reference: text("reference"),
    designation: text("designation"),
    note: text("note"),
    /** Screen 75 — whose name we printed, so the choice is auditable later. */
    designationSource: text("designation_source"), // client|supplier|manufacturer|internal

    unit: text("unit"),
    qty: numeric("qty", { precision: 16, scale: 4 }),
    unitPrice: numeric("unit_price", { precision: 16, scale: 4 }),

    /**
     * WHAT THE LINE COST US, and where that figure came from. Screen 12's Cost
     * and Margin columns — visible to the Gérant, hidden from the Commercial.
     *
     * Margin has NO column and will not get one. It is
     * `(unitPrice − unitCost) / unitCost`, computed wherever it is shown. Storing
     * cost, price AND margin is three numbers that can disagree, and the day they
     * do, nobody can say which two are right.
     *
     * The cost is stored rather than looked up from `price_quote` at render time
     * because it is the figure the price was actually set from. Six weeks later
     * the supplier's quote may have expired or been superseded, and an offer
     * whose margin silently changes because a supplier re-quoted is an offer
     * nobody can reason about. `costQuoteId` keeps the trail back to the quote.
     */
    unitCost: numeric("unit_cost", { precision: 16, scale: 4 }),
    /** supplier_quote | internal_costing | previous_offer | manual */
    costSource: text("cost_source"),
    costQuoteId: uuid("cost_quote_id"),
    discountPct: numeric("discount_pct", { precision: 6, scale: 3 }).default("0"),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }), // 19.00 | 9.00 | 0.00
    /** When VAT is 0, the exemption must name its article. */
    vatExemptRef: text("vat_exempt_ref"),
    totalExcl: numeric("total_excl", { precision: 16, scale: 2 }),
  },
  (table) => [
    // Every render, every builder and every total reads a document's lines in
    // order; without this each one scans the whole table.
    index("document_line_document_idx").on(table.documentId, table.position),
  ],
);

export const documentLink = pgTable(
  "document_link",
  {
    fromDocument: uuid("from_document")
      .notNull()
      .references(() => document.id),
    toDocument: uuid("to_document")
      .notNull()
      .references(() => document.id),
    /** A proforma may NEVER carry `settles`. Enforced by trigger. */
    relation: text("relation").notNull(),
    // converted_to | covers | credits | settles | amends | closes
    //
    // `amends` — an avenant on the marché it changes.
    // `closes` — the décompte final on the marché it settles.
  },
  (t) => [primaryKey({ columns: [t.fromDocument, t.toDocument, t.relation] })],
);
