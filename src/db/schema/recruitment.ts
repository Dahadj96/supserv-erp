import {
  boolean,
  date,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { person } from "./party";
import { project } from "./project";

/**
 * Screens 24, 25 and 26 — candidates and personnel requests.
 *
 * A CANDIDATE IS A PERSON. `person.relationship = "candidate"` has been one of
 * the five values since phase 1, and screen 24's own breadcrumb reads
 * "People / Candidates" — it is a view of the people list, not a second list of
 * humans. The three recruitment columns live on `person` for that reason; they
 * are null for everybody who did not arrive as a candidate, and a candidate who
 * is hired keeps their row, their trade and their certifications and changes
 * one field.
 *
 * That is the whole reason this file is small. What is here is the thing the
 * people table cannot hold: a request for two welders in In Salah by the 24th,
 * and who is being considered for it.
 */

/**
 * "REQ-2026-007 — 2 soudeurs, In Salah, needed 24 Aug."
 *
 * A request is raised by a site and answered by people. It is NOT a job
 * advertisement and it is not a headcount plan: it exists because a project
 * needs two welders on a date, and the only interesting questions about it are
 * how many are confirmed and whether their tickets will still be valid when
 * they arrive.
 */
export const personnelRequest = pgTable("personnel_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** REQ-2026-007. Ours, allocated on creation. */
  ref: text("ref").notNull().unique(),

  /** "Soudeur", "Électricien BT" — the trade asked for, in the site's words. */
  role: text("role").notNull(),

  /** The site it is for. Null for a request that is not against a project. */
  projectId: uuid("project_id").references(() => project.id),
  /** Where the work is. It decides who can take it — see `person.mobility`. */
  wilaya: text("wilaya"),

  needed: integer("needed").notNull().default(1),
  /** When they have to be on site. What makes a request urgent. */
  startOn: date("start_on"),

  /**
   * Whether the client requires a valid certification for every person on this
   * site. TouatGaz does for welding; a manœuvre needs nothing.
   *
   * It is a fact about the CONTRACT, recorded by a person, and it is what turns
   * a candidate with an expiring ticket from a note into a refusal.
   */
  certificationRequired: boolean("certification_required").notNull().default(false),

  /** open | filled | cancelled — the last two are decisions, see below. */
  status: text("status").notNull().default("open"),
  cancelledReason: text("cancelled_reason"),

  note: text("note"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Who is being considered, and how far along.
 *
 * One row per person per request. `stage` here is about THIS request — the same
 * welder can be confirmed on one site and merely shortlisted for another, and a
 * single stage on the person would make that impossible to say.
 */
export const personnelCandidate = pgTable(
  "personnel_candidate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => personnelRequest.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),

    /** new | reviewing | shortlisted | interview | confirmed | rejected */
    stage: text("stage").notNull().default("new"),
    /** Required for `rejected`, the same rule the go/no-go card follows. */
    rejectedReason: text("rejected_reason"),

    note: text("note"),
    addedBy: text("added_by"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("personnel_candidate_once").on(t.requestId, t.personId)],
);

/**
 * A note dated in the future is how this system already models a task
 * (screen 55). Recruitment adds nothing to that, so there is no interview
 * table: an interview is a note with a date, on the person.
 */
export const RECRUITMENT_NOTE = "interview";
