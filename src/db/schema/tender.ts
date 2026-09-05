import { date, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { deal } from "./deal";
import { party } from "./party";

/**
 * Screens 07 and 08 — tenders and the dossier.
 *
 * A TENDER IS A DEAL. It has a client, a subject, a deadline, lines, an offer
 * and an outcome, and every one of those already lives on `deal`. What a tender
 * has that an ordinary enquiry does not is a procedure, a place to deposit the
 * envelope, a bid bond, and a folder of administrative papers that will get the
 * bid thrown out if one of them has expired.
 *
 * So there is no `tender` list beside the deal list. There is one row here per
 * deal that is answering a formal procedure, and screen 07 is the deal list
 * with that row joined on.
 */
export const tender = pgTable("tender", {
  dealId: uuid("deal_id")
    .primaryKey()
    .references(() => deal.id, { onDelete: "cascade" }),

  /**
   * aonr | aoo | consultation | rfq | gre_a_gre.
   *
   * The procedure the buyer is running, in their own vocabulary. It decides
   * almost nothing in code and everything in the office: an AONR has a public
   * opening session and a bid bond, a consultation usually has neither.
   */
  procedure: text("procedure").notNull(),

  /** "DD Adrar, bureau des marchés". Where the envelope physically goes. */
  submissionPlace: text("submission_place"),

  /**
   * The opening session — séance d'ouverture des plis. A separate date from the
   * closing time, usually hours later, and worth holding because somebody may
   * attend it.
   */
  opensAt: timestamp("opens_at", { withTimezone: true }),

  /**
   * CAUTION DE SOUMISSION — the bid bond.
   *
   * Both the amount and the percentage, because the cahier des charges states
   * one or the other and converting between them needs an estimate that may
   * change. Whichever the buyer wrote is what is kept.
   *
   * `requestedAt` and `receivedAt` are the two facts nobody can infer: the bank
   * takes days, and a tender whose bond was never requested is a tender that
   * will be rejected at the desk with everything else in order.
   */
  cautionAmount: numeric("caution_amount", { precision: 16, scale: 2 }),
  cautionPct: numeric("caution_pct", { precision: 6, scale: 3 }),
  cautionRequestedAt: timestamp("caution_requested_at", { withTimezone: true }),
  cautionReceivedAt: timestamp("caution_received_at", { withTimezone: true }),

  /** How long our offer must stand, in days. The client's requirement. */
  offerValidityDays: integer("offer_validity_days"),

  /**
   * That the envelope was actually deposited, and the receipt they gave for it.
   *
   * This is stored because it is unknowable otherwise, exactly like `lostAt` on
   * the deal: no document in this system records that a man carried an envelope
   * to a counter in Adrar. The receipt reference is what proves it if the buyer
   * later says nothing arrived.
   */
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  submittedBy: text("submitted_by"),
  depositReceiptRef: text("deposit_receipt_ref"),

  /**
   * Screen 42's subtitle — "read from BPU.xls".
   *
   * The name of the file the bordereau was read from, kept so the header can
   * say where forty-two lines came from without anybody having to remember.
   * Null while the lines were typed rather than imported, which is also normal.
   */
  bpuSource: text("bpu_source"),
  bpuImportedAt: timestamp("bpu_imported_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The company's own papers, held once.
 *
 * CNAS, CASNOS, the extrait de rôle, the casier judiciaire of the gérant, the
 * statuts, the certificat de qualification. Every tender asks for the same
 * ones, each has ONE expiry date, and that date is the single most common
 * reason a bid is thrown out.
 *
 * Held once, per company, rather than copied into each tender's folder. A CNAS
 * attestation renewed in March must not leave eleven tenders still pointing at
 * the February one — and it would, because nobody goes back through old
 * folders. `tender_piece` points here by key.
 */
export const companyCredential = pgTable("company_credential", {
  /** cnas | casnos | rc_copy | extrait_role | casier_judiciaire | statuts | … */
  key: text("key").primaryKey(),

  /** "RC 01/00-0123456 B 09", "catégorie 3". Verbatim from the paper. */
  reference: text("reference"),

  issuedOn: date("issued_on"),
  /** Null means it does not expire — the statuts do not. */
  expiresOn: date("expires_on"),

  /** Where the scan is, in the working store. Null means nobody has filed it. */
  fileId: text("file_id"),

  note: text("note"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * ONE ROW PER PIECE THIS TENDER'S CAHIER DES CHARGES ASKS FOR.
 *
 * Not a list of what Algerian law requires. PLAN §8 rule 5 is explicit — no
 * legal claim is asserted without an authority and a confirmer — and "a tender
 * requires an attestation CNAS" is exactly such a claim. It is also not
 * reliably true: what is required is whatever THIS buyer wrote in THIS dossier,
 * and it differs between SADEG and ANBT for the same kind of work.
 *
 * So the rows are seeded from a default list when a tender is created, and from
 * that moment they are this tender's list: a person adds what the cahier des
 * charges asks for and removes what it does not. `addedBy` records who said so,
 * which is LAW 2 applied to a folder.
 *
 * The STATE of a piece is never stored. Ready, missing, expiring and expired
 * are computed from the credential's expiry against this tender's closing date,
 * and a piece that was ready in July is not ready in September without anybody
 * touching a row.
 */
export const tenderPiece = pgTable("tender_piece", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealId: uuid("deal_id")
    .notNull()
    .references(() => deal.id, { onDelete: "cascade" }),

  /** administratif | technique | financier — the three envelopes. */
  section: text("section").notNull(),
  position: integer("position").notNull(),

  /** A stable key for the seeded ones; free text for anything a person adds. */
  key: text("key").notNull(),
  /** What the cahier des charges calls it, verbatim when somebody typed it. */
  label: text("label"),

  /**
   * Set when this piece is satisfied by a company-level paper rather than by
   * something written for this tender. Null for the planning d'exécution, the
   * lettre de soumission, the BPU.
   */
  credentialKey: text("credential_key"),

  /**
   * For the tender-specific ones: the file that satisfies it.
   *
   * There was a `provided_at` beside it, mentioned nowhere in the application
   * and dropped on 5 September 2026. A piece is provided when it HAS a file —
   * one fact, computed, and `added_at` already says when the row appeared.
   */
  fileId: text("file_id"),

  note: text("note"),
  addedBy: text("added_by"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Screen 42 — how this client's bordereau is laid out.
 *
 * "Confirm once — remembered for this client." A BPU arrives as a spreadsheet
 * with the buyer's own column headings: SADEG writes `N° de prix`, ANBT writes
 * `Num`, and one of them puts the unit before the designation. The mapping is
 * proposed from the headings and CONFIRMED BY A PERSON, never guessed silently
 * — screen 62's columns file says why, and the reason is stronger here: a
 * column called `Montant` read as a unit price puts a wrong figure on a
 * submitted bid.
 *
 * Keyed on the client, not on the tender, because the same authority publishes
 * the same template four times a year and nobody should confirm it four times.
 */
export const bpuMapping = pgTable("bpu_mapping", {
  partyId: uuid("party_id")
    .primaryKey()
    .references(() => party.id, { onDelete: "cascade" }),
  /** { sourceColumn: target | null }. Null means deliberately ignored. */
  mapping: jsonb("mapping").notNull(),
  confirmedBy: text("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * AN ERRATUM THAT HAS ARRIVED AND HAS NOT BEEN APPLIED.
 *
 * A fortnight before the deadline, with thirty-one lines priced, the buyer
 * issues a corrected bordereau. Re-importing it is correct and throws away
 * every price already gathered. So it lands HERE first, as the lines it
 * contains and nothing more, and the screen shows the diff against what is
 * held. A person applies it.
 *
 * The lines are stored verbatim as read from the file. That is the point: the
 * row is evidence of what the buyer sent, and it stays readable after the
 * lines have moved underneath it.
 */
export const bpuErratum = pgTable("bpu_erratum", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealId: uuid("deal_id")
    .notNull()
    .references(() => deal.id, { onDelete: "cascade" }),

  filename: text("filename"),
  /** The date the buyer put on it, which is not the date it was read. */
  receivedOn: date("received_on"),

  /** `BpuLine[]`, verbatim from the file. */
  lines: jsonb("lines").notNull(),

  /** pending | applied | discarded */
  status: text("status").notNull().default("pending"),

  addedBy: text("added_by"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  appliedBy: text("applied_by"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  discardedAt: timestamp("discarded_at", { withTimezone: true }),
  /** Why it was applied over an issued offer, or why it was thrown away. */
  reason: text("reason"),
});
