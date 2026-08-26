import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Screen 65 — Approvals.
 *
 * The banner on that frame is the reason this table is not the audit log:
 *
 *   "The audit log records what happened. These rules stop it happening until
 *    someone with the authority agrees. Different jobs — the system needs both."
 *
 * `audit_entry` is written AFTER the fact and never blocks anything; it is the
 * record. A gate is written BEFORE, and the action does not happen until
 * somebody decides. Merging them would mean either an audit log that can refuse
 * things — so a failed write loses the record of the attempt — or a gate that
 * only warns, which the frame rules out in as many words: "Blocked, not warned".
 */

/**
 * A rule that stops an action. Data, not code, so screen 65's "What is gated"
 * is a list somebody can read and change rather than a grep.
 *
 * `role` is who may decide. Not a list of people — a role, because the person
 * holding it changes and a gate naming Y. Gourari personally is a gate that
 * breaks when he leaves.
 */
export const approvalGate = pgTable("approval_gate", {
  /** offer.marginBelowFloor, relance.escalation, … */
  code: text("code").primaryKey(),
  /** gerant | commercial | … — see src/auth/can.ts. */
  role: text("role").notNull().default("gerant"),
  /**
   * The threshold this gate fires at, when it has one. 15 for "margin below
   * 15%", 8 for "discount above 8%". Null for the gates that are conditions
   * rather than numbers.
   */
  threshold: integer("threshold"),
  /** A reason code must be chosen from a list before the request can be made. */
  requiresReasonCode: boolean("requires_reason_code").notNull().default(true),
  /** And a sentence in somebody's own words. Screen 65: "Required". */
  requiresJustification: boolean("requires_justification").notNull().default(true),
  enabled: boolean("enabled").notNull().default(true),
  position: integer("position").notNull().default(0),
});

/**
 * One thing waiting on a decision.
 *
 * `before` and `after` are stored on the request, not looked up when it is
 * read. Screen 65's approver "sees before and after", and six weeks later the
 * before may no longer exist — the offer was re-priced, the supplier quote
 * expired. A gate that showed today's values against a decision made in August
 * would be reconstructing history, which is the exact thing the card in the
 * corner says this table exists to avoid.
 */
export const approvalRequest = pgTable("approval_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  gateCode: text("gate_code")
    .notNull()
    .references(() => approvalGate.code),

  /** What is blocked: document | deal | relance | party … */
  entity: text("entity").notNull(),
  entityId: text("entity_id").notNull(),
  /** One line naming the thing, frozen at request time for the same reason. */
  subject: text("subject").notNull(),

  /** Frozen. See the note above. */
  before: jsonb("before"),
  after: jsonb("after"),

  /** Chosen from a list. */
  reasonCode: text("reason_code"),
  /** In their own words. Screen 65 requires it and this is why the gate has
   *  any value at all six months later. */
  justification: text("justification"),

  requestedBy: text("requested_by").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),

  /** waiting | approved | declined | withdrawn */
  status: text("status").notNull().default("waiting"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  /**
   * What the decider said. Optional on an approval, and the reason a decline
   * is not a dead end: "the draft stays, nothing is lost", and this is where
   * the person who asked finds out what to change.
   */
  decisionNote: text("decision_note"),

  /**
   * True when the person who asked is the person who decided.
   *
   * Screen 65: "Self-approval — allowed, still recorded." In a company where
   * one man is the Gérant and the Commercial at once, refusing self-approval
   * would make the system unusable and teach him to work around it. Recording
   * it costs nothing and is the whole point: six months later the log says why
   * the margin was 11.4%, and nobody is reconstructing it from memory.
   */
  selfApproved: boolean("self_approved").notNull().default(false),
});
