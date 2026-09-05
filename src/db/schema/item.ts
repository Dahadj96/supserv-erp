import { boolean, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { party } from "./party";

export const item = pgTable("item", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(), // ITM-0412
  designation: text("designation").notNull(),
  brand: text("brand"),
  model: text("model"),
  unit: text("unit"),
  kind: text("kind").notNull(), // good | service
  /**
   * Screen 78: câble HP, boulonnerie, main-d'œuvre. No manufacturer publishes a
   * datasheet for these, so "no datasheet" is complete, not a gap.
   */
  isGeneric: boolean("is_generic").notNull().default(false),
  supersededBy: uuid("superseded_by"),
});

/**
 * Screen 75 — the client calls it one thing, the supplier another, and you have to
 * decide which name goes on the offer. Keep all of them, mark the preferred one.
 */
export const itemAlias = pgTable(
  "item_alias",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => item.id),
    alias: text("alias").notNull(),
    source: text("source").notNull(), // client | supplier | manufacturer | internal
    partyId: uuid("party_id").references(() => party.id), // whose word this is
    preferOnOffer: boolean("prefer_on_offer").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.alias] })],
);

/**
 * Screen 77. The technical file belongs to the ITEM, so a datasheet found once
 * serves every future deal — with one exception, below.
 *
 * THIS ROW OWNS ITS BYTES. `src/domain/files/index.ts` says there is no `file`
 * table and there is not going to be one: every file is recorded by whatever
 * brought it in, and the files screen is a view over those owners. This is the
 * fourth owner.
 *
 * It used to carry `file_id uuid not null` pointing at that table which does
 * not exist, and nothing ever inserted a row — so screen 77 listed nothing,
 * screen 78's "datasheet held" was false for every item for ever, and a tender
 * asking for a fiche technique had nowhere to keep the answer.
 */
export const itemMedia = pgTable("item_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => item.id),

  /** Where the bytes are, under the working store. Never a path a person typed. */
  storagePath: text("storage_path").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type"),
  sizeBytes: integer("size_bytes"),

  mediaKind: text("media_kind").notNull(), // datasheet|photo|certificate|diagram|manual
  /** Provenance decides what a file may be used for. Never drop it. */
  provenance: text("provenance").notNull(), // supplier|manufacturer|our_photo|client
  partyId: uuid("party_id").references(() => party.id),
  capturedAtPlace: text("captured_at_place"), // "Ets Chergui, Adrar"
  /**
   * THE EXCEPTION: a picture the client sent belongs to the deal it arrived on,
   * because it records what THAT client asked for. Everything else is item-wide.
   *
   * There was a `locked` boolean beside this saying the same thing twice. LAW 1:
   * a deal id IS the lock, and two columns that must agree are one that can be
   * wrong.
   */
  dealId: uuid("deal_id"),

  addedBy: text("added_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Screen 78 — per deal, per item: is a datasheet required, and do we have one. */
export const itemCoverage = pgTable(
  "item_coverage",
  {
    dealId: uuid("deal_id").notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => item.id),
    requirement: text("requirement").notNull(), // required | kept_anyway | not_stated
    status: text("status").notNull(), // complete | missing | not_applicable
    notApplicableReason: text("not_applicable_reason"),
  },
  (t) => [primaryKey({ columns: [t.dealId, t.itemId] })],
);
