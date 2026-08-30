import {
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { item } from "./item";
import { party, person } from "./party";

/**
 * Screens 05 and 06 — the enquiry.
 *
 * Screen 05's subtitle is the whole design of this table: **"stage is computed
 * from the documents, outcome is read from the offer."** The filter row above
 * the list is labelled `STAGE — derived`. So there is no `stage` column here,
 * and there will not be one. LAW 1.
 *
 * What IS stored is only what nobody can work out from anything else:
 *
 *  - what the client asked for, and when they need it (facts they gave us)
 *  - what we decided to do about it, and why (a decision a person made)
 *  - that we lost it (a fact only the client knows, which they tell you by
 *    telephone and which no document in this system will ever contain)
 *
 * Everything else — new, qualifying, sourcing, offer out, ordered, invoiced,
 * won — falls out of what exists. `src/domain/deal/stage.ts` does the falling.
 */
export const deal = pgTable("deal", {
  id: uuid("id").primaryKey().defaultRandom(),

  /** ENQ-2026-0141. Ours, allocated on creation — an enquiry is not a document
   *  and does not fall under LAW 5's issue-time numbering. */
  ref: text("ref").notNull().unique(),

  partyId: uuid("party_id")
    .notNull()
    .references(() => party.id),
  /** The buyer we are dealing with. Null when the enquiry arrived from a mailbox
   *  nobody has put a name to yet. */
  contactPersonId: uuid("contact_person_id").references(() => person.id),

  subject: text("subject").notNull(),

  /**
   * THE CLIENT'S OWN REFERENCE — `25/DA/2026`, `PR 3000116322`.
   *
   * Kept verbatim and never parsed. It is how they will refer to this in every
   * email and on the order that eventually arrives, and a "tidied" version of
   * it is a reference that matches nothing on their side.
   */
  clientReference: text("client_reference"),

  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),

  /**
   * Screen 06 prints this in red when it is close. It is what the CLIENT said,
   * and it is the single most valuable field extraction produces.
   */
  deadlineAt: timestamp("deadline_at", { withTimezone: true }),

  /**
   * email | deposit_sealed | portal | hand_delivered | unknown.
   *
   * Screen 06's red banner exists for one value of this: "TouatGaz does not
   * accept submission by email. This consultation must be deposited at the DA
   * office." An offer emailed to a client who requires a sealed deposit is not
   * late, it is discarded — and the system that knew and did not say so is
   * worse than no system.
   */
  submissionMethod: text("submission_method").notNull().default("unknown"),

  currency: text("currency").notNull().default("DZD"),
  /**
   * Who is answerable for it. Screen 05's Owner column.
   *
   * `text`, not `uuid`, and every actor column in this file is the same. An
   * Entra ID object id is an opaque string — it happens to look like a uuid
   * today and there is no promise that it always will. Migration 0012 already
   * learned this the hard way on `audit_entry.entity_id`.
   */
  ownerId: text("owner_id"),
  /** How it reached us — mirrors intake_channel.key, or "manual". */
  source: text("source").notNull().default("manual"),
  /** The intake message it came from, when it came from one. */
  intakeMessageId: uuid("intake_message_id"),

  /**
   * Screen 06's go/no-go card: null | pursue | no_bid.
   *
   * Null means nobody has looked yet, which is a real state and the reason the
   * card is at the top of the screen. "Recorded so we can learn from it" is the
   * caption, so the reason is stored alongside and is required for no_bid.
   */
  decision: text("decision"),
  decisionReason: text("decision_reason"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedBy: text("decided_by"),

  /** What we think it is worth, in the deal's currency. A person's estimate,
   *  not a computation — it is entered before any price exists. */
  expectedValue: numeric("expected_value", { precision: 16, scale: 2 }),

  /**
   * WHAT THE CLIENT REQUIRES. Screen 67 checks every supplier answer against
   * these three, and the checks are the most valuable thing sourcing does.
   *
   * All three are extracted by `proposeFields` and are null until a person
   * confirms them (LAW 2) — a conflict raised against a requirement nobody
   * confirmed is a false alarm, and false alarms are how people learn to click
   * past red boxes.
   *
   * `requiredValidityDays` — how long our offer must stand. When a supplier
   * holds their price for less, we would be committed at a price our supplier
   * is not.
   * `requiredDeliveryDays` — from order to site. A supplier slower than this
   * means late penalties, which is why the penalty text is kept beside it.
   */
  requiredValidityDays: integer("required_validity_days"),
  requiredDeliveryDays: integer("required_delivery_days"),

  /**
   * Screen 78's toggle: did the client ask for fiches techniques?
   *
   * required | kept_anyway | not_stated. It decides whether a missing datasheet
   * BLOCKS the offer or is merely worth knowing — "when required, a missing
   * datasheet blocks submission". Defaults to `not_stated`, which blocks
   * nothing, because a requirement nobody stated is not a requirement.
   */
  datasheetRequirement: text("datasheet_requirement").notNull().default("not_stated"),
  /** "1‰ par jour, plafonné à 10%" — verbatim, because it is contractual. */
  latePenalty: text("late_penalty"),

  /**
   * The client's instructions, verbatim, from the email or the dossier.
   * Screen 06: "verbatim — the email is the archive". Never summarised: the
   * sentence about the sealed double envelope is the one that loses the bid.
   */
  clientInstructions: text("client_instructions"),

  /**
   * Lost, and why. Stored because it is unknowable otherwise — no document we
   * hold records that somebody else won. `wonAt` has no column on purpose:
   * winning shows up as an order, and an order is a document.
   */
  lostAt: timestamp("lost_at", { withTimezone: true }),
  lostReason: text("lost_reason"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Screen 83 — the thirty-day bin, same as every other record. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
  deleteReason: text("delete_reason"),
});

/**
 * A line the client asked for.
 *
 * Screen 06 prints "6 lines · **no client item codes stored — reference only**"
 * over this table, and that note is a rule. `reference` is the string the
 * CLIENT wrote — `VP-DN80-16` — and it is not our item code, not a foreign key,
 * and not cleaned up. Matching it to something in the catalogue is a separate,
 * reversible act recorded in `itemId`; until somebody does that, the line still
 * works, still gets priced, and still appears on the offer.
 *
 * Storing the client's string in `item.code` would be the classic mistake: two
 * clients call two different valves `VP-DN80-16` and the catalogue quietly
 * merges them.
 */
export const dealLine = pgTable(
  "deal_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deal.id, { onDelete: "cascade" }),
    /** Position as the client numbered it. Their #4 stays our #4. */
    position: integer("position").notNull(),

    /** Verbatim from the client. Never our code. */
    reference: text("reference"),
    designation: text("designation").notNull(),

    qty: numeric("qty", { precision: 16, scale: 3 }).notNull().default("1"),
    unit: text("unit"),

    /** Set when a person matches this line to the catalogue. Null is normal. */
    itemId: uuid("item_id").references(() => item.id),
    /** How the match was made: typed | alias | exact_code | suggested. Kept so a
     *  wrong match made by a suggestion can be told from one a person chose. */
    matchedBy: text("matched_by"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("deal_line_position").on(t.dealId, t.position)],
);

/**
 * Screens 74 and 86 — where a price came from.
 *
 * `docs/PLAN.md` §3.4, and the sentence under it is the one that matters:
 *
 *   "A price with `is_verbal = true` and no `evidence_file_id` is usable, and
 *   is labelled as unconfirmed everywhere it appears. This is the
 *   shop-counter case and it is normal, not an error."
 *
 * That is LAW 2 applied to money rather than to dates. A price a man said over
 * a counter in Adrar is a real price — it is how half this business is done —
 * and a system that refuses to hold it is a system people keep a notebook
 * beside. So it is held, and it is labelled, and the label travels with it onto
 * the offer.
 *
 * The provenance is never inferred. There is no rule anywhere that promotes a
 * verbal price to a confirmed one because time passed or because it was used
 * on an offer. Only attaching evidence does that, and attaching evidence is
 * something a person does.
 */
export const priceQuote = pgTable("price_quote", {
  id: uuid("id").primaryKey().defaultRandom(),

  /** A price is always FOR something. One of these is set, never neither. */
  itemId: uuid("item_id").references(() => item.id),
  dealLineId: uuid("deal_line_id").references(() => dealLine.id, { onDelete: "set null" }),
  /** Which enquiry it was gathered for, when it was gathered for one. A price
   *  with no deal is a catalogue price and serves every future enquiry.
   *
   *  `set null` rather than `cascade`, and the difference matters: deleting an
   *  enquiry must not destroy the evidence of what a supplier said something
   *  cost in August. The price survives its enquiry and becomes a catalogue
   *  price, which is exactly what it always was. */
  dealId: uuid("deal_id").references(() => deal.id, { onDelete: "set null" }),

  /**
   * WHAT THE PRICE WAS FOR, in words, copied from the line when it was captured.
   *
   * Redundant while the line exists and the only thing left when it does not.
   * Screen 06 replaces an enquiry's lines whenever somebody corrects a paste,
   * and `deal_line_id` is `on delete set null` — so a shop-counter price for
   * an article nobody has matched to the catalogue lost its last subject and
   * `price_quote_has_a_subject` refused the whole correction. Screen 86 calls
   * that price normal, not an error, so the answer is not to refuse it or
   * delete it: it is for the row to remember, on its own, what it was a price
   * for. "21 400 DZD, vanne papillon DN80, Ets Chergui, 4 November" is
   * evidence. "21 400 DZD" is not.
   */
  designation: text("designation"),

  /** supplier_email | supplier_proforma | shop_visit | phone | internal_costing */
  source: text("source").notNull(),
  /** Who quoted it. Null for internal_costing — that one is us. */
  partyId: uuid("party_id").references(() => party.id),

  price: numeric("price", { precision: 16, scale: 4 }).notNull(),
  currency: text("currency").notNull().default("DZD"),
  /** Whether the price is before VAT. Suppliers quote both ways and the
   *  difference is 19%, which is the whole margin. */
  isExclVat: boolean("is_excl_vat").notNull().default(true),

  /** Said, not written. Shown as unconfirmed wherever it appears. */
  isVerbal: boolean("is_verbal").notNull().default(false),
  /** The proforma, the photo of the price tag, the email. Null for a verbal. */
  evidenceFileId: uuid("evidence_file_id"),

  capturedBy: text("captured_by"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  /** "Ets Chergui, Adrar" — screen 86 fills this from your last three visits. */
  capturedPlace: text("captured_place"),
  /** Who said it, when the who is a person rather than a company. */
  capturedFrom: text("captured_from"),

  /** After this date the price is stale and screens say so. Never auto-deleted:
   *  an old price is evidence of what something used to cost. */
  validUntil: date("valid_until"),
});
