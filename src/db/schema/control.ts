import { bigserial, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Screen 84 — a merge is not a delete.
 *
 * CL-0031 is retired, not removed. Every document ever issued under it keeps
 * its number and still resolves, so nobody has to explain a missing reference
 * to a client two years from now.
 */
export const mergeLog = pgTable("merge_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  entity: text("entity").notNull(), // party | person | item | contact
  keptId: uuid("kept_id").notNull(),
  retiredId: uuid("retired_id").notNull(),
  /** Every field chosen, so "who decided this?" has an answer. */
  fieldChoices: jsonb("field_choices").notNull(),
  movedCounts: jsonb("moved_counts").notNull(),
  mergedBy: text("merged_by"),
  mergedAt: timestamp("merged_at", { withTimezone: true }).notNull().defaultNow(),
  reversibleUntil: timestamp("reversible_until", { withTimezone: true }),
});

/**
 * "Not a duplicate" is remembered so the same pair is never suggested again.
 *
 * Two companies can share a phone number and be genuinely different. Without
 * this table the system nags forever and people learn to ignore it.
 */
export const duplicateDismissal = pgTable(
  "duplicate_dismissal",
  {
    entity: text("entity").notNull(),
    /** Stored low-id-first so the pair is one row whichever way it is found. */
    aId: uuid("a_id").notNull(),
    bId: uuid("b_id").notNull(),
    dismissedBy: text("dismissed_by"),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
    reason: text("reason"),
  },
  (t) => [primaryKey({ columns: [t.entity, t.aId, t.bId] })],
);

/** PLAN §3.6 — an audit entry outlives the record it describes. */
export const auditEntry = pgTable("audit_entry", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actorId: text("actor_id"),
  actorKind: text("actor_kind").notNull().default("user"), // user | assistant | system
  entity: text("entity").notNull(),
  entityId: uuid("entity_id"),
  action: text("action").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  reason: text("reason"),
  sourceScreen: text("source_screen"),
});
