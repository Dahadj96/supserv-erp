import { date, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { document } from "./document";
import { person } from "./party";

/**
 * Screens 49 and 14 — the bon de livraison.
 *
 * A BL IS A DOCUMENT, not a fourth kind of record. It goes through the same
 * engine, the same numbering series, the same templates and the same PDF as
 * every other document (LAW 3, and rule 1 of `docs/PLAN.md` §8: "No module
 * renders a PDF"). So there is no `delivery_note` table holding lines and
 * totals — `document` and `document_line` already do that, with kind
 * `delivery_note`.
 *
 * What this table holds is everything a BL has that no other document does:
 * how it travelled and who signed for it. Those are not invoice fields, they
 * are not offer fields, and putting them on `document` would leave nine null
 * columns on every facture in the register.
 *
 * The banner on screen 49 states the shape:
 *
 *   "A delivery note can be issued without an invoice, and one invoice can
 *    cover several delivery notes. The link is kept both ways."
 *
 * That link is `document_link` with relation `covers`, which already exists.
 * No new linkage table.
 */
export const deliveryDetail = pgTable("delivery_detail", {
  /** One row per delivery-note document. The document is the record. */
  documentId: uuid("document_id")
    .primaryKey()
    .references(() => document.id, { onDelete: "cascade" }),

  /* ---- Packing and transport. Printed on the BL. ---- */
  packages: integer("packages"),
  grossWeightKg: numeric("gross_weight_kg", { precision: 12, scale: 3 }),
  volumeM3: numeric("volume_m3", { precision: 12, scale: 3 }),
  carrier: text("carrier"),
  vehicle: text("vehicle"),
  driver: text("driver"),
  departsAt: timestamp("departs_at", { withTimezone: true }),

  /* ---- Where it goes, and who takes it. ---- */
  deliveryAddress: text("delivery_address"),
  siteContactId: uuid("site_contact_id").references(() => person.id),
  /** Kept verbatim when the person on site is not in the address book. */
  siteContactName: text("site_contact_name"),

  /**
   * THE FACT THE WHOLE DOCUMENT EXISTS FOR.
   *
   * Screen 49: "Without a signed delivery note, a delivery dispute has no
   * answer. This is the document that protects the invoice."
   *
   * `receivedBy` and `receivedOn` are what the client's man wrote on the paper.
   * `signedCopyOnFile` is somebody saying the signed copy has come back and is
   * filed — a different fact from "we delivered it", and the one screen 14's
   * amber banner is about. It is a date rather than a boolean so that "when did
   * it come back" is answerable, and null means it has not.
   */
  receivedBy: text("received_by"),
  receivedOn: date("received_on"),
  signedCopyOnFile: timestamp("signed_copy_on_file", { withTimezone: true }),
  signedCopyBy: text("signed_copy_by"),

  /**
   * What the client wrote in the reserves box. Verbatim, because it is the
   * thing that gets read out in a dispute, and a tidied version of it is
   * evidence of nothing.
   */
  reserves: text("reserves"),

  /**
   * THE OTHER SIDE'S OWN REFERENCE FOR THE SAME MOVEMENT.
   *
   * Added for screen 68. A goods receipt is a bon de livraison read from the
   * other end: the supplier hands over their BL-HE-4412, we write our
   * BR-2026-0021 against it, and every conversation afterwards - the one where
   * they say two crates are missing - happens in THEIR number, because it is
   * the number on the paper in the driver's hand.
   *
   * On our own delivery notes it holds the client's reception reference when
   * they give one. Same fact from the opposite side, so it is one column and
   * not two. Null is normal and means nobody wrote a number down.
   *
   * `delivery_detail` takes it rather than a new table for the same reason it
   * exists at all: a goods receipt is a movement of goods with a signature on
   * it, which is precisely what this row already holds. Reusing it means screen
   * 68 needed no schema of its own beyond this line.
   */
  counterpartyRef: text("counterparty_ref"),
});
