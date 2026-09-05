import { date, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { deal } from "./deal";
import { document } from "./document";
import { party, person } from "./party";

/**
 * Screens 15 and 16 — projects.
 *
 * What happens after a tender is won and before the last invoice is paid. For
 * a company doing travaux — raccordement BT, VRD, a pumping station — that
 * period is most of the year, and almost none of it is visible in the enquiry
 * and invoice screens.
 *
 * Three things live here that live nowhere else:
 *
 *   the situations — progressive billing against work actually done,
 *   the retenue de garantie — money the client keeps for a year after the work,
 *   the cautions — bank guarantees with their own expiry dates, which the
 *     client can call in if they lapse.
 *
 * A project ALWAYS belongs to a deal. Not because the schema needs it, but
 * because a project with no enquiry behind it is work nobody can trace to a
 * price, a client order or an offer, and this system has spent seven phases
 * making sure everything traces. The deal carries the client, the subject and
 * the contract; this row carries what the site does.
 */
export const project = pgTable("project", {
  id: uuid("id").primaryKey().defaultRandom(),

  /** PRJ-2026-004. Ours, allocated on creation. */
  code: text("code").notNull().unique(),

  dealId: uuid("deal_id")
    .notNull()
    .references(() => deal.id),
  partyId: uuid("party_id")
    .notNull()
    .references(() => party.id),

  /** "Raccordement BT lot 4, Adrar centre" — what the site is. */
  object: text("object").notNull(),
  /** The client's own contract reference: MAR/2026/018. Verbatim. */
  contractRef: text("contract_ref"),
  /** Where the work is. Adrar, In Salah, Reggane — it decides the travel. */
  wilaya: text("wilaya"),

  /** The contract value, excluding VAT. What the situations bill against. */
  amountExcl: numeric("amount_excl", { precision: 16, scale: 2 }),
  currency: text("currency").notNull().default("DZD"),

  startedOn: date("started_on"),
  /**
   * The contractual end AS THE MARCHÉ WAS SIGNED. Late penalties run from it —
   * see `deal.latePenalty` for the clause in the client's own words.
   *
   * An avenant de prolongation moves it; that new date lives on the avenant
   * (`amendment_detail.new_contractual_end`) and not here, for the reason an
   * avenant's quantities do not overwrite the marché's: this column is what
   * the signed contract said, and `deadlineOf` composes the rest.
   */
  contractualEnd: date("contractual_end"),

  /**
   * PÉNALITÉS DE RETARD, as the CCAP of this marché states them.
   *
   * Per mille of the marché per day of delay, capped at a percentage of it —
   * "1‰ par jour, plafonné à 10 %" is the common wording, and the wording
   * itself is kept verbatim on the deal. These two are the arithmetic, read
   * off the CCAP by a person, the same act as reading the retention off it.
   *
   * Null means nobody has read the clause yet, and NOTHING is computed: a
   * penalty this system invented would be a legal claim with no authority
   * behind it, which is the one thing it does not do.
   */
  penaltyPerMille: numeric("penalty_per_mille", { precision: 6, scale: 3 }),
  penaltyCapPct: numeric("penalty_cap_pct", { precision: 6, scale: 3 }),
  /**
   * WHAT THE PENALTY IS TAKEN ON — `excl` or `incl`, the same two words the
   * retention uses and for the same reason. A marché is signed TTC on the
   * acte d'engagement and billed HT on the bordereau, so "du montant du
   * marché" is two different figures depending on which paper you are holding,
   * and only the CCAP says which one the clause means.
   */
  penaltyBase: text("penalty_base"),

  /**
   * PHYSICAL PROGRESS IS A PERSON'S ESTIMATE, and it is stored for exactly that
   * reason.
   *
   * Financial progress is arithmetic — approved situations over the contract
   * value — and is computed everywhere it appears. Physical progress is a chef
   * de chantier looking at a trench and saying sixty per cent, and there is no
   * honest way to derive it. So it is stored, with who said so and when, and
   * screen 16 prints the two side by side: the gap between them is the single
   * most useful number on the page, because work done and not yet billed is
   * money the company has spent and not asked for.
   */
  physicalPercent: integer("physical_percent"),
  physicalBy: text("physical_by"),
  physicalAt: timestamp("physical_at", { withTimezone: true }),

  /**
   * THE DQE CONTRACTUEL — the issued document whose lines are the contract's
   * bordereau: the client's order when they sent one, otherwise the offer they
   * accepted. Every situation's lines point at this document's lines
   * (`document_line.source_line_id`), which is what makes "quantité marché ·
   * cumul précédent · période · cumul à ce jour" arithmetic instead of typing.
   *
   * A person chose it when the project was opened. Null on projects opened
   * before this column existed, and `contractOf` then falls back to the deal's
   * latest issued order or offer without writing the guess down.
   */
  contractDocumentId: uuid("contract_document_id").references(() => document.id),

  /** Retenue de garantie — the percentage the client holds back per situation. */
  retentionPct: numeric("retention_pct", { precision: 6, scale: 3 }).notNull().default("0"),
  /**
   * WHAT THE RETENTION IS TAKEN ON — `excl` (the HT of the situation) or `incl`
   * (the TTC). Both are seen on Algerian décomptes and the CCAP of the marché
   * says which; it is the contract's fact, not a company setting, which is why
   * it is here and not on screen 85. Null means nobody has read the CCAP yet,
   * and a situation with a retention cannot be raised until somebody has.
   */
  retentionBase: text("retention_base"),
  /** How long after the PV définitif the retention is held. Usually twelve. */
  warrantyMonths: integer("warranty_months"),

  /** Réception provisoire and définitive. Both are facts about a signed paper. */
  pvProvisoireOn: date("pv_provisoire_on"),
  pvProvisoirePlanned: date("pv_provisoire_planned"),
  pvDefinitiveOn: date("pv_definitive_on"),

  closedAt: timestamp("closed_at", { withTimezone: true }),

  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
  deleteReason: text("delete_reason"),
});

/**
 * What a situation is, beyond being a document.
 *
 * The document already holds the lines, the totals, the number and the issue
 * date — kind `situation` has been in the catalogue since phase 3. What it does
 * not hold is which period the work covers, what was done in it, and the date
 * the client's engineer signed it off, which is a different date from the day
 * it was submitted and is the one that starts the payment clock.
 *
 * Same shape as `delivery_detail`, for the same reason: nine columns that would
 * be null on every facture in the register.
 */
export const situationDetail = pgTable("situation_detail", {
  documentId: uuid("document_id")
    .primaryKey()
    .references(() => document.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),

  /** n° 3. The client counts them and so must we. */
  sequence: integer("sequence").notNull(),
  periodFrom: date("period_from"),
  periodTo: date("period_to"),
  /** "Raccordements et essais" — what was done, in the words on the paper. */
  workDone: text("work_done"),

  submittedOn: date("submitted_on"),
  /**
   * When the client's engineer signed it. NOT when we sent it — a situation
   * sitting unapproved for twenty-one days is the thing screen 15's banner is
   * about, and it can only be seen by holding both dates.
   */
  approvedOn: date("approved_on"),
  approvedBy: text("approved_by"),
});

/**
 * What an avenant is, beyond being a document.
 *
 * Its lines already say what it does to the bordereau — each one pointing at
 * the line of the marché it replaces, or at nothing, which adds a price. What
 * they cannot say is the two things an avenant does that have no line at all:
 * it moves the délai, and it gives a reason.
 *
 * An avenant de prolongation de délai is common and carries no prices at all.
 * Without this row such an avenant could not be recorded, and the deadline the
 * penalties run from would still be the one on the signed marché — which is
 * how a company computes a penalty against itself that nobody is owed.
 *
 * Same shape as `situation_detail`, for the same reason.
 */
export const amendmentDetail = pgTable("amendment_detail", {
  documentId: uuid("document_id")
    .primaryKey()
    .references(() => document.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),

  /**
   * The délai as this avenant leaves it. Null when it does not touch it —
   * most avenants only move quantities, and a date repeated from the marché
   * would read as a decision somebody made.
   */
  newContractualEnd: date("new_contractual_end"),

  /** "Quantités supplémentaires, terrain rocheux" — why, in their words. */
  reason: text("reason"),
});

/**
 * Bank guarantees, with the dates that make them dangerous.
 *
 * Caution de bonne exécution, restitution d'avance, retenue de garantie
 * substituted by a bond. Each one is money the bank has promised the client on
 * SUPSERV's behalf, each has an expiry, and a lapsed one can be called in — the
 * client draws on it and the company argues afterwards.
 *
 * They are per PROJECT, not per company, which is why they are not in
 * `company_credential` beside the CNAS attestation: two live cautions on one
 * project and none on another is normal, and their expiries are contractual
 * dates rather than administrative ones.
 */
export const projectCaution = pgTable("project_caution", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),

  /** bonne_execution | restitution_avance | retenue_garantie | soumission */
  kind: text("kind").notNull(),
  pct: numeric("pct", { precision: 6, scale: 3 }),
  amount: numeric("amount", { precision: 16, scale: 2 }),
  currency: text("currency").notNull().default("DZD"),

  bankName: text("bank_name"),
  reference: text("reference"),
  issuedOn: date("issued_on"),
  expiresOn: date("expires_on"),

  /** Given back by the client. Null while it is still live. */
  releasedOn: date("released_on"),

  note: text("note"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Who is on site.
 *
 * The people are `person` rows and their tickets are `person_certification`
 * rows — both since phase 1, both already carrying expiry dates. This table
 * says only who is on THIS site and since when, so that "H. Ferhat's soudage
 * certificate expires 30 August and he is welding on Adrar centre today" is a
 * question the system can answer.
 *
 * `proposedAt` without `onSiteSince` is somebody put forward for the job and
 * not yet there — screen 16 draws that as its own state, because a proposed
 * welder is not a welder.
 */
export const projectCrew = pgTable("project_crew", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
  personId: uuid("person_id")
    .notNull()
    .references(() => person.id),

  /** What they are doing here, when it differs from their usual trade. */
  role: text("role"),

  proposedAt: timestamp("proposed_at", { withTimezone: true }),
  onSiteSince: date("on_site_since"),
  leftOn: date("left_on"),

  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
