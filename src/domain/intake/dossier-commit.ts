import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal } from "@/db/schema/deal";
import { extractionField, intakeDossier } from "@/db/schema/dossier";
import { intakeMessage } from "@/db/schema/intake";
import { tender } from "@/db/schema/tender";
import { type FieldKey, readFrenchDateTime } from "./extract";

/**
 * Screen 40 → screen 06. The end of the pipeline.
 *
 * CAPTURE → ASSEMBLE → DIGITISE → CLASSIFY → EXTRACT → REVIEW → **COMMIT**, and
 * until this file existed the last arrow did not. Six facts a person had
 * checked against the page they came from sat in `extraction_field`, which
 * nothing outside screen 40 reads. A deadline confirmed on Tuesday was still
 * not on the deal on Friday, and `deal.required_validity_days` and
 * `deal.late_penalty` had no writer anywhere in `src/app` — so the checks in
 * `sourcing-store.ts` and `offer/submit.ts` that compare a supplier's answer
 * against what the client requires were comparing against null, silently, for
 * every deal there has ever been.
 *
 * LAW 2 governs the whole file. **Only a confirmed row may be read.** A
 * proposal is what a regular expression thought; it becomes a fact when
 * somebody says so against the source, and this reads `status IN (confirmed,
 * corrected) AND confirmed_at IS NOT NULL` and nothing else. There is no path
 * through this module that carries a proposal.
 */

/** What a person confirmed. `corrected` is still confirmed — by a person, harder. */
const CONFIRMED = ["confirmed", "corrected"];

export type CarrySkip =
  /** The deal already has a value there, put by somebody or something else. */
  | "alreadySet"
  /** It belongs on `tender`, and this deal is not one. */
  | "noTender"
  /** The confirmed text could not be read as the kind of value the column holds. */
  | "unreadable"
  /** A validity in months, and the column counts days. See the note below. */
  | "unitNotDays";

export type CarryOutcome = {
  dealId: string;
  /** Which fields landed, and on which record. */
  carried: { key: FieldKey; on: "deal" | "tender" }[];
  /** Which did not, and why — the screen prints every one. */
  skipped: { key: FieldKey; reason: CarrySkip }[];
};

export class NoDealForDossier extends Error {
  constructor() {
    super("noDealForDossier");
  }
}

/**
 * A date out of a confirmed field.
 *
 * TWO SHAPES, because a person may have typed one. `value` is the ISO the
 * reader normalised; `confirmedValue` is that same ISO when the person simply
 * agreed, and whatever they typed when they did not — and the box they type in
 * is prefilled with `display`, which is "02/09/2026 · 10:00". So a corrected
 * deadline arrives in French office format, and reading it with `Date` alone
 * would silently make it null or, worse, read 02/09 as the second of September
 * in one place and the ninth of February in another.
 */
function dateFrom(text: string): Date | null {
  const iso = /^\d{4}-\d{2}-\d{2}T/.test(text) ? new Date(text) : null;
  if (iso && !Number.isNaN(iso.getTime())) return iso;

  const read = readFrenchDateTime(text);
  if (!read) return null;
  const parsed = new Date(read.iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * "180 jours" → 180. "3 mois" → nothing, on purpose.
 *
 * `required_validity_days` counts days, and a validity stated in months cannot
 * fill it without somebody deciding what a month is. Thirty days is the obvious
 * answer and it is wrong twice a year; more to the point it would be an
 * invisible assumption inside a contractual figure that decides whether our
 * offer still stands. So it is refused by name and the screen says so, and the
 * person puts the number on the deal themselves.
 */
function daysFrom(text: string): { days: number | null; monthsInstead: boolean } {
  const m = text.match(/(\d{1,3})\s*(jours?|mois|j\b)/i);
  if (!m) return { days: null, monthsInstead: false };
  if (/mois/i.test(m[2] ?? "")) return { days: null, monthsInstead: true };
  return { days: Number(m[1]), monthsInstead: false };
}

/** "84 200,00 DZD (1%)" → an amount, a percentage, or both. */
function bondFrom(text: string): { amount: string | null; pct: string | null } {
  const amount = text.match(/([\d][\d\s.]*(?:,\d{1,2})?)\s*(?:dzd|da\b|dinars?)/i);
  const pct = text.match(/(\d+(?:[.,]\d+)?)\s*%/);

  return {
    // French figures: space is the thousands separator and the comma is the
    // decimal point. `numeric(16,2)` wants neither.
    amount: amount?.[1] ? amount[1].replace(/[\s.]/g, "").replace(",", ".") : null,
    pct: pct?.[1] ? pct[1].replace(",", ".") : null,
  };
}

/**
 * The deal this dossier is about, when anything already knows.
 *
 * `intake_message.committed_entity` is written by screen 02 the moment somebody
 * turns a message into a deal. A dossier read from an attachment on that same
 * message is therefore already attached to the deal, through the message, and
 * the screen only has to ask whether to carry the fields — not which deal.
 *
 * It is a SUGGESTION and the person presses. Nothing here writes.
 */
export async function dealBehindDossier(
  dossierId: string,
): Promise<{ id: string; subject: string } | null> {
  const [row] = await db
    .select({
      dealId: intakeDossier.dealId,
      committedEntity: intakeMessage.committedEntity,
      committedEntityId: intakeMessage.committedEntityId,
    })
    .from(intakeDossier)
    .leftJoin(intakeMessage, eq(intakeDossier.messageId, intakeMessage.id))
    .where(eq(intakeDossier.id, dossierId))
    .limit(1);
  if (!row) return null;

  const id =
    row.dealId ?? (row.committedEntity === "deal" ? (row.committedEntityId ?? null) : null);
  if (!id) return null;

  const [found] = await db
    .select({ id: deal.id, subject: deal.subject })
    .from(deal)
    .where(eq(deal.id, id))
    .limit(1);

  return found ?? null;
}

/**
 * Carry every confirmed field onto the deal.
 *
 * WHAT IT WILL NOT OVERWRITE. A column that already has a value is left alone
 * and reported as `alreadySet`. Two reasons, and the second is the real one:
 * a deadline on the deal may have been typed by a person who read the covering
 * email, and this dossier is one attachment of seven — the newest reading is
 * not automatically the truest. Rather than choose, the screen shows what it
 * did not write and what the document says instead, and a person settles it in
 * the one place where both values are visible at once. A silent overwrite of a
 * submission deadline is the single most expensive thing this file could do.
 *
 * WHAT NEEDS A TENDER. Place of deposit, opening session and the bid bond are
 * columns on `tender`, and a deal with no tender row has nowhere to put them.
 * They are skipped as `noTender` rather than refused as an error, because the
 * deadline and the penalty still belong on the deal and losing all six over
 * three is worse than carrying three. Screen 06's "Make this a tender" (2.1)
 * is one press, and the screen says so.
 */
export async function commitDossierToDeal(opts: {
  dossierId: string;
  dealId: string;
  actorId: string;
}): Promise<CarryOutcome> {
  const [dossier] = await db
    .select({ id: intakeDossier.id, filename: intakeDossier.filename })
    .from(intakeDossier)
    .where(eq(intakeDossier.id, opts.dossierId))
    .limit(1);
  if (!dossier) throw new Error("noSuchDossier");

  const [target] = await db.select().from(deal).where(eq(deal.id, opts.dealId)).limit(1);
  if (!target) throw new NoDealForDossier();

  const [tenderRow] = await db.select().from(tender).where(eq(tender.dealId, opts.dealId)).limit(1);

  const fields = await db
    .select({
      key: extractionField.key,
      value: extractionField.value,
      confirmedValue: extractionField.confirmedValue,
    })
    .from(extractionField)
    .where(
      and(
        eq(extractionField.dossierId, opts.dossierId),
        inArray(extractionField.status, CONFIRMED),
        isNotNull(extractionField.confirmedAt),
      ),
    );

  const carried: CarryOutcome["carried"] = [];
  const skipped: CarryOutcome["skipped"] = [];

  const onDeal: Record<string, unknown> = {};
  const onTender: Record<string, unknown> = {};

  for (const field of fields) {
    const key = field.key as FieldKey;
    // What the PERSON settled on. `value` is only the fallback for a row
    // confirmed before `confirmed_value` was written, and it is the same text.
    const said = (field.confirmedValue ?? field.value).trim();

    switch (key) {
      case "submissionDeadline": {
        const when = dateFrom(said);
        if (!when) skipped.push({ key, reason: "unreadable" });
        else if (target.deadlineAt) skipped.push({ key, reason: "alreadySet" });
        else {
          onDeal.deadlineAt = when;
          carried.push({ key, on: "deal" });
        }
        break;
      }

      case "latePenalty": {
        // Verbatim. `deal.late_penalty` is text precisely because it is
        // contractual language, and "1‰ par jour, plafonné à 10%" is the
        // sentence somebody will have to argue from.
        if (target.latePenalty) skipped.push({ key, reason: "alreadySet" });
        else {
          onDeal.latePenalty = said;
          carried.push({ key, on: "deal" });
        }
        break;
      }

      case "offerValidity": {
        const { days, monthsInstead } = daysFrom(said);
        if (monthsInstead) {
          skipped.push({ key, reason: "unitNotDays" });
          break;
        }
        if (days === null) {
          skipped.push({ key, reason: "unreadable" });
          break;
        }
        /*
          TWO COLUMNS, ONE FACT, AND BOTH ARE WANTED.

          `deal.required_validity_days` is what screen 67 checks a supplier's
          quote against — it applies to an ordinary enquiry as much as to a
          tender. `tender.offer_validity_days` is the same number on the tender
          record, where screen 08 reads it. Writing only one leaves whichever
          screen reads the other still empty, which is the shape of bug this
          whole task exists to end.
        */
        if (target.requiredValidityDays !== null) {
          skipped.push({ key, reason: "alreadySet" });
          break;
        }
        onDeal.requiredValidityDays = days;
        carried.push({ key, on: "deal" });
        if (tenderRow && tenderRow.offerValidityDays === null) onTender.offerValidityDays = days;
        break;
      }

      case "whereToDeposit": {
        if (!tenderRow) skipped.push({ key, reason: "noTender" });
        else if (tenderRow.submissionPlace) skipped.push({ key, reason: "alreadySet" });
        else {
          onTender.submissionPlace = said;
          carried.push({ key, on: "tender" });
        }
        break;
      }

      case "openingSession": {
        if (!tenderRow) {
          skipped.push({ key, reason: "noTender" });
          break;
        }
        const when = dateFrom(said);
        if (!when) skipped.push({ key, reason: "unreadable" });
        else if (tenderRow.opensAt) skipped.push({ key, reason: "alreadySet" });
        else {
          onTender.opensAt = when;
          carried.push({ key, on: "tender" });
        }
        break;
      }

      case "bidBond": {
        if (!tenderRow) {
          skipped.push({ key, reason: "noTender" });
          break;
        }
        const { amount, pct } = bondFrom(said);
        if (!amount && !pct) skipped.push({ key, reason: "unreadable" });
        else if (tenderRow.cautionAmount || tenderRow.cautionPct)
          skipped.push({ key, reason: "alreadySet" });
        else {
          // Whichever the buyer wrote is what is kept — the schema says so, and
          // converting between them needs an estimate that may change.
          if (amount) onTender.cautionAmount = amount;
          if (pct) onTender.cautionPct = pct;
          carried.push({ key, on: "tender" });
        }
        break;
      }
    }
  }

  if (Object.keys(onDeal).length > 0) {
    await db.update(deal).set(onDeal).where(eq(deal.id, opts.dealId));
  }
  if (tenderRow && Object.keys(onTender).length > 0) {
    await db.update(tender).set(onTender).where(eq(tender.dealId, opts.dealId));
  }

  // The link, whether or not anything was carried. "This document was read for
  // this deal" is worth knowing even when every field was already set, and it
  // is what stops a second press looking like a first one.
  await db
    .update(intakeDossier)
    .set({ dealId: opts.dealId })
    .where(eq(intakeDossier.id, opts.dossierId));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "deal",
    entityId: opts.dealId,
    action: "update",
    after: {
      fromDossier: opts.dossierId,
      filename: dossier.filename,
      carried: carried.map((c) => `${c.key}→${c.on}`),
      skipped: skipped.map((s) => `${s.key}:${s.reason}`),
    },
    sourceScreen: "40",
  });

  return { dealId: opts.dealId, carried, skipped };
}
