import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Screen 44 — what the assistant has proposed, and what a person did about it.
 *
 * LAW 6 in a table. A proposal is a row saying "somebody might want to do
 * this"; it touches nothing else in the system. The thing it proposes happens
 * only when a person approves it, and even then the applying is done by
 * `src/domain/assistant/apply.ts` — outside `src/assistant`, which is not
 * allowed to write to a business table at all.
 *
 * The row keeps BOTH the proposal and the decision, forever. A declined
 * proposal is not deleted: "the assistant suggested chasing TOUATGAZ on the
 * 3rd and I said no" is a fact worth having when the same question comes round
 * in November.
 */
export const assistantProposal = pgTable("assistant_proposal", {
  id: uuid("id").primaryKey().defaultRandom(),

  /** Which registry tool made it. Always one with `kind: "propose"`. */
  tool: text("tool").notNull(),

  /**
   * Who asked. Not "who the assistant is" — it has no identity of its own and
   * holds exactly this person's permissions.
   */
  requestedBy: text("requested_by").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),

  /** What it is about. Text id, matching `audit_entry.entity_id`. */
  entity: text("entity").notNull(),
  entityId: text("entity_id"),

  /** One line, for the list. */
  title: text("title").notNull(),
  /** The whole proposed text, exactly as it would be used. Never a summary. */
  body: text("body").notNull(),

  /**
   * Where every claim in the body came from: `[{ label, href }]`.
   *
   * Not decoration. A proposal a person cannot check is one they will either
   * rubber-stamp or ignore, and both are worse than not proposing.
   */
  citations: jsonb("citations").notNull(),

  /** waiting | approved | declined | withdrawn — see MACHINES.assistant_proposal. */
  status: text("status").notNull().default("waiting"),

  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),

  /**
   * What approving it created, once it has. Null while waiting, and null on a
   * decline forever — which is how you tell "approved and applied" from
   * "approved and the apply failed".
   */
  appliedEntity: text("applied_entity"),
  appliedEntityId: text("applied_entity_id"),
});
