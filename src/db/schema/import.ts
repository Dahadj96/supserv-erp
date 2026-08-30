import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Screen 62 — Move in.
 *
 * "Your Excel files and OneDrive folders stay exactly where they are. This
 * copies what is useful into the system and tells you what it could not read."
 *
 * Two promises on that screen shape these tables. "Excel files changed — Never"
 * means nothing is ever written back, so there is no need to record a source
 * state. "Import can be undone — Within 7 days" means every record created has
 * to remember which import made it, which is what `import_record` is for.
 */
export const importBatch = pgTable("import_batch", {
  id: uuid("id").primaryKey().defaultRandom(),

  filename: text("filename").notNull(),
  sheetName: text("sheet_name"),
  /** upload | onedrive. OneDrive discovery needs Graph Files.Read — see below. */
  sourceKind: text("source_kind").notNull().default("upload"),

  /**
   * What the sheet becomes: party | contact | person | deal_line | bpu_erratum.
   *
   * The last two are screen 42's. A bordereau is not a list of records that
   * become rows in a catalogue — it belongs to one enquiry — which is why
   * `dealId` below is set for those two and null for the rest.
   */
  becomes: text("becomes").notNull(),

  /** The enquiry a bordereau was read for. Null for every other kind of sheet. */
  dealId: uuid("deal_id"),

  /** { sourceColumn: targetField | null }. Null means deliberately ignored. */
  mapping: jsonb("mapping").notNull(),

  /** mapping | previewed | imported | undone */
  status: text("status").notNull().default("mapping"),

  rowsTotal: integer("rows_total").notNull().default(0),
  rowsImported: integer("rows_imported").notNull().default(0),
  rowsSkipped: integer("rows_skipped").notNull().default(0),

  /** Screen 62: "Problems found — handled, not hidden." */
  problems: jsonb("problems"),

  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  importedAt: timestamp("imported_at", { withTimezone: true }),
  undoableUntil: timestamp("undoable_until", { withTimezone: true }),
  undoneAt: timestamp("undone_at", { withTimezone: true }),
});

/**
 * One row per record an import created.
 *
 * Deliberately a separate table rather than a column on `party` and `person`.
 * An import is an event that happened to a record, not a property of it — and a
 * record that is later merged, renamed or re-imported should not carry a stale
 * batch id for the rest of its life.
 */
export const importRecord = pgTable("import_record", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => importBatch.id, { onDelete: "cascade" }),
  entity: text("entity").notNull(), // party | person
  entityId: uuid("entity_id").notNull(),
  /** Which line of the spreadsheet this came from, for "row 41 was skipped". */
  sourceRow: integer("source_row").notNull(),
});
