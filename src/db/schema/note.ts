import { date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Screen 56 — the one thing on a deal timeline that has nowhere else to live.
 *
 * Almost every row on that page is DERIVED: a message arrived, a quote came
 * back, a document was issued, a decision was recorded. All of those are facts
 * some other table already holds, and the timeline reads them.
 *
 * Two are not. "Called A&C purchasing about the deposit window — they confirmed
 * the office accepts deposits from 08:00. Bring two sealed envelopes." Nothing
 * in this system saw that happen. It exists because somebody put the phone down
 * and typed it, and if there is no table for it, it goes in a notebook and is
 * lost the day the notebook is.
 *
 * THIS IS NOT A TASK TABLE, and the difference is worth being exact about.
 * Screen 55 refuses a task table because a task duplicates state: an invoice is
 * unpaid OR the task to chase it is open, and the two drift. A note duplicates
 * nothing — it is the only record of a thing that happened outside the system.
 *
 * `dueAt` is the seam between the two ideas. A note with a date is what a
 * person means by a task, and Today reads it from HERE rather than from a
 * second list. One place it is written, many places it is read.
 */
export const note = pgTable(
  "note",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** deal | party | document | person — whatever it is about. */
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),

    /**
     * note | call | meeting | visit.
     *
     * A logged call is not a note with the word "called" in it: six months
     * later "did we ever actually speak to them" is a question somebody asks,
     * and the answer should not depend on how the sentence was phrased.
     */
    kind: text("kind").notNull().default("note"),

    /** Verbatim. A tidied note is somebody's later summary of what was said. */
    body: text("body").notNull(),

    /**
     * When the thing happened, which is not when it was typed. A call made in
     * the car and written up that evening happened in the car, and a timeline
     * ordered by typing time puts it after things that came later.
     */
    happenedAt: timestamp("happened_at", { withTimezone: true }).notNull().defaultNow(),

    /** Set when this note is also something to do. Read by screen 55. */
    dueAt: date("due_at"),
    /** When somebody said it was dealt with. Null while it still stands. */
    doneAt: timestamp("done_at", { withTimezone: true }),

    authorId: text("author_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    /** The bin, same as everywhere. A note is never hard-deleted. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
    deleteReason: text("delete_reason"),
  },
  (t) => [
    index("note_about_idx").on(t.entity, t.entityId, t.happenedAt),
    // Screen 55 asks "what is due" across every entity at once.
    index("note_due_idx").on(t.dueAt),
  ],
);
