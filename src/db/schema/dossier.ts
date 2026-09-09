import {
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { deal } from "./deal";
import { intakeAttachment, intakeMessage } from "./intake";

/**
 * Screens 39 and 40 — a document that has been read, and what was read from it.
 *
 * The whole pipeline is CAPTURE → ASSEMBLE → DIGITISE → CLASSIFY → EXTRACT →
 * REVIEW → COMMIT, and these three tables hold the middle of it. Built once,
 * they serve tenders, CVs, supplier quotes, invoices received, delivery notes
 * and bank statements.
 */
export const intakeDossier = pgTable("intake_dossier", {
  id: uuid("id").primaryKey().defaultRandom(),

  /** Where it came from, when it came from somewhere. */
  messageId: uuid("message_id").references(() => intakeMessage.id),
  attachmentId: uuid("attachment_id").references(() => intakeAttachment.id),

  /**
   * WHERE IT WENT — the deal its confirmed fields were carried onto (task 2.4).
   *
   * Until this column existed, the pipeline ended at `extraction_field`: six
   * facts a person had checked against the page they came from, sitting in a
   * table nothing outside screen 40 reads. A deadline confirmed on Tuesday did
   * not appear on the deal, and `deal.required_validity_days` and
   * `deal.late_penalty` had no writer anywhere in the application.
   *
   * Written by `commitDossierToDeal`, which is a person pressing a button —
   * never by the reader. It records that the carrying HAPPENED, so a second
   * press is visible as one and so screen 06 can link back to the document a
   * field came from. It is not a claim that every field made it: which ones
   * did is in the audit entry, because some are skipped and the reason
   * matters.
   */
  dealId: uuid("deal_id").references(() => deal.id),

  filename: text("filename").notNull(),
  storagePath: text("storage_path").notNull(),
  /**
   * What the bytes were stored as — and therefore what `/api/files/dossier:<id>`
   * declares when it serves them back.
   *
   * Written by the ingest rather than assumed by the reader. Screen 60 used to
   * say `application/pdf` for every dossier, on the true-at-the-time grounds
   * that the only writer put it there; since 1.6 a dossier may be a Word or an
   * Excel file, and a claim like that is the kind that goes quietly wrong the
   * day it stops holding. Null on rows written before this column, which the
   * files screen reads as "no type declared" — the same honest answer as an
   * attachment nobody typed one for.
   */
  contentType: text("content_type"),

  /** text-layer | docx | xlsx | ocr | rapid | azure — which reader read it. */
  provider: text("provider"),
  /** LAW 4 — the language the DOCUMENT is in, not the language of the reader. */
  locale: text("locale"),
  pages: integer("pages").notNull().default(0),

  /**
   * Pages whose text layer was too thin to be the document. Not an error and
   * not hidden: a dossier half of which is a scan is still worth reviewing, and
   * the person needs to know which half the system could not read.
   */
  unreadPages: jsonb("unread_pages"),

  /** reading | review | confirmed | failed */
  status: text("status").notNull().default("reading"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One page of text.
 *
 * Stored rather than re-read, because screen 40 highlights the sentence a field
 * came from and re-parsing a 38-page PDF on every keystroke is not a design.
 */
export const intakePage = pgTable(
  "intake_page",
  {
    dossierId: uuid("dossier_id")
      .notNull()
      .references(() => intakeDossier.id, { onDelete: "cascade" }),
    page: integer("page").notNull(),
    text: text("text").notNull(),
  },
  (t) => [primaryKey({ columns: [t.dossierId, t.page] })],
);

/**
 * One field somebody has to confirm.
 *
 * Screen 40: "This is the only place extraction becomes fact." So the proposed
 * value and the confirmed value are DIFFERENT COLUMNS. `value` is what the
 * machine read and never changes; `confirmedValue` is what a person said it is.
 * Keeping both is what makes it possible, two years later, to ask whether the
 * extraction was wrong or the person was.
 */
export const extractionField = pgTable("extraction_field", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossierId: uuid("dossier_id")
    .notNull()
    .references(() => intakeDossier.id, { onDelete: "cascade" }),

  key: text("key").notNull(), // submissionDeadline | bidBond | ...

  /** What was read. Never edited — a correction goes in `confirmedValue`. */
  value: text("value").notNull(),
  display: text("display").notNull(),
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
  /** Why it is not certain: severalCandidates, hedged, longSentence, … */
  caveat: text("caveat"),

  /** The citation. A field that cannot be checked has no business on screen 40. */
  citationPage: integer("citation_page").notNull(),
  citationQuote: text("citation_quote").notNull(),
  citationArticle: text("citation_article"),

  /** proposed | confirmed | corrected | rejected */
  status: text("status").notNull().default("proposed"),
  confirmedValue: text("confirmed_value"),
  confirmedBy: text("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
});
