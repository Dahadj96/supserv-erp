import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal } from "@/db/schema/deal";
import { extractionField, intakeDossier, intakePage } from "@/db/schema/dossier";
import { party, partyRole } from "@/db/schema/party";
import { tender, tenderPiece } from "@/db/schema/tender";
import { createDeal } from "@/domain/deal/deal";
import { commitDossierToDeal } from "@/domain/intake/dossier-commit";
import { makeTender } from "@/domain/tender/store";

/**
 * 2.4 — the last arrow of the pipeline, against a real database.
 *
 * CAPTURE → ASSEMBLE → DIGITISE → CLASSIFY → EXTRACT → REVIEW → COMMIT. Six
 * facts a person had confirmed against the page they came from used to stop at
 * `extraction_field`, so `deal.required_validity_days` and `deal.late_penalty`
 * had no writer anywhere and the checks that compare a supplier's answer to
 * what the client requires compared against null, silently, on every deal.
 *
 * What these tests hold is the two halves of LAW 2 at once: a CONFIRMED field
 * must reach the deal, and a PROPOSED one must never.
 */

const ACTOR = "test-carry-actor";
const NOW = new Date("2026-08-21T09:00:00Z");
const stamp = Date.now().toString().slice(-6);

let clientId = "";
const deals: string[] = [];
const dossiers: string[] = [];

async function newDeal(subject: string, over: { deadlineAt?: Date | null } = {}) {
  const id = await createDeal(
    {
      partyId: clientId,
      subject,
      contactPersonId: null,
      clientReference: null,
      receivedAt: NOW,
      deadlineAt: over.deadlineAt ?? null,
      submissionMethod: "unknown",
      currency: "DZD",
      ownerId: null,
      source: "manual",
      intakeMessageId: null,
      expectedValue: null,
      clientInstructions: null,
    },
    ACTOR,
  );
  deals.push(id);
  return id;
}

/** A dossier with fields already in whatever state the test needs. */
async function newDossier(
  fields: { key: string; value: string; status: string; confirmedValue?: string }[],
) {
  const [row] = await db
    .insert(intakeDossier)
    .values({
      filename: `rc-${stamp}.pdf`,
      storagePath: `dossiers/test-${stamp}`,
      contentType: "application/pdf",
      pages: 1,
      status: "review",
    })
    .returning({ id: intakeDossier.id });

  const id = row?.id as string;
  dossiers.push(id);

  if (fields.length > 0) {
    await db.insert(extractionField).values(
      fields.map((f) => ({
        dossierId: id,
        key: f.key,
        value: f.value,
        display: f.value,
        confidence: "0.900",
        citationPage: 1,
        citationQuote: `… ${f.value} …`,
        status: f.status,
        confirmedValue: f.status === "proposed" ? null : (f.confirmedValue ?? f.value),
        confirmedBy: f.status === "proposed" ? null : ACTOR,
        confirmedAt: f.status === "proposed" ? null : new Date(),
      })),
    );
  }

  return id;
}

beforeAll(async () => {
  const [client] = await db
    .insert(party)
    .values({
      code: `CL-C4${stamp.slice(-5)}`,
      legalName: "GROUPEMENT REGGANE (TEST 2.4)",
    })
    .returning({ id: party.id });
  clientId = client?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });
});

afterAll(async () => {
  const fields =
    dossiers.length > 0
      ? await db
          .select({ id: extractionField.id })
          .from(extractionField)
          .where(inArray(extractionField.dossierId, dossiers))
      : [];

  const ids = [...deals, ...dossiers, ...fields.map((f) => f.id), clientId].filter(Boolean);
  if (ids.length > 0) await db.delete(auditEntry).where(inArray(auditEntry.entityId, ids));

  if (dossiers.length > 0) {
    await db.delete(extractionField).where(inArray(extractionField.dossierId, dossiers));
    await db.delete(intakePage).where(inArray(intakePage.dossierId, dossiers));
    await db.delete(intakeDossier).where(inArray(intakeDossier.id, dossiers));
  }
  if (deals.length > 0) {
    // `makeTender` seeds the folder, and a piece points at its tender.
    await db.delete(tenderPiece).where(inArray(tenderPiece.dealId, deals));
    await db.delete(tender).where(inArray(tender.dealId, deals));
    await db.delete(deal).where(inArray(deal.id, deals));
  }
  if (clientId) {
    await db.delete(partyRole).where(eq(partyRole.partyId, clientId));
    await db.delete(party).where(eq(party.id, clientId));
  }
});

describe("2.4 — confirmed extractions reach the deal", () => {
  it("puts a confirmed deadline, validity and penalty on the deal", async () => {
    const dealId = await newDeal("Fourniture de bureau — carry");
    const dossierId = await newDossier([
      { key: "submissionDeadline", value: "2026-09-30T10:00:00", status: "confirmed" },
      { key: "offerValidity", value: "180 jours", status: "confirmed" },
      { key: "latePenalty", value: "1% par jour, plafonné à 10%", status: "confirmed" },
    ]);

    const out = await commitDossierToDeal({ dossierId, dealId, actorId: ACTOR });
    expect(out.carried.map((c) => c.key).sort()).toEqual([
      "latePenalty",
      "offerValidity",
      "submissionDeadline",
    ]);

    const [after] = await db.select().from(deal).where(eq(deal.id, dealId)).limit(1);
    expect(after?.deadlineAt?.toISOString()).toContain("2026-09-30");
    expect(after?.requiredValidityDays).toBe(180);
    // Verbatim: `late_penalty` is text because it is contractual language.
    expect(after?.latePenalty).toBe("1% par jour, plafonné à 10%");
  });

  it("never reads a field nobody confirmed — LAW 2", async () => {
    /*
      The whole law in one test. A proposal is what a regular expression
      thought; it becomes a fact when somebody says so against the source. A
      deal whose deadline was set by a reading nobody checked is the failure
      screen 40 exists to prevent, and there must be no path here that does it.
    */
    const dealId = await newDeal("Nothing confirmed");
    const dossierId = await newDossier([
      { key: "submissionDeadline", value: "2026-09-30T10:00:00", status: "proposed" },
      { key: "offerValidity", value: "90 jours", status: "proposed" },
      { key: "latePenalty", value: "5% par jour", status: "rejected" },
    ]);

    const out = await commitDossierToDeal({ dossierId, dealId, actorId: ACTOR });
    expect(out.carried).toEqual([]);

    const [after] = await db.select().from(deal).where(eq(deal.id, dealId)).limit(1);
    expect(after?.deadlineAt).toBeNull();
    expect(after?.requiredValidityDays).toBeNull();
    expect(after?.latePenalty).toBeNull();
  });

  it("takes the corrected value when a person disagreed with the reader", async () => {
    // The box a person types in is prefilled with `display`, so a correction
    // arrives in French office format rather than as an ISO string. Reading it
    // with `Date` alone would make 30/09 the ninth of… something.
    const dealId = await newDeal("Corrected deadline");
    const dossierId = await newDossier([
      {
        key: "submissionDeadline",
        value: "2026-09-30T10:00:00",
        status: "corrected",
        confirmedValue: "15/10/2026 · 09:00",
      },
    ]);

    await commitDossierToDeal({ dossierId, dealId, actorId: ACTOR });

    const [after] = await db.select().from(deal).where(eq(deal.id, dealId)).limit(1);
    expect(after?.deadlineAt?.toISOString()).toContain("2026-10-15");
  });

  it("leaves a deadline the deal already has, and says it did", async () => {
    /*
      The deadline on the deal may have been typed by somebody who read the
      covering email, and this dossier is one attachment of seven. The newest
      reading is not automatically the truest, so nothing is overwritten and
      the screen reports what it did not write.
    */
    const already = new Date("2026-09-01T08:00:00Z");
    const dealId = await newDeal("Already has a deadline", { deadlineAt: already });
    const dossierId = await newDossier([
      { key: "submissionDeadline", value: "2026-09-30T10:00:00", status: "confirmed" },
    ]);

    const out = await commitDossierToDeal({ dossierId, dealId, actorId: ACTOR });
    expect(out.carried).toEqual([]);
    expect(out.skipped).toEqual([{ key: "submissionDeadline", reason: "alreadySet" }]);

    const [after] = await db.select().from(deal).where(eq(deal.id, dealId)).limit(1);
    expect(after?.deadlineAt?.toISOString()).toBe(already.toISOString());
  });

  it("carries the tender fields onto the tender, and the deal fields anyway", async () => {
    const dealId = await newDeal("A real tender");
    await makeTender({ dealId, procedure: "aonr", actorId: ACTOR });

    const dossierId = await newDossier([
      { key: "submissionDeadline", value: "2026-09-30T10:00:00", status: "confirmed" },
      { key: "openingSession", value: "2026-09-30T14:00:00", status: "confirmed" },
      { key: "whereToDeposit", value: "bureau des marchés de la DD Adrar", status: "confirmed" },
      { key: "bidBond", value: "84 200,00 DZD (1%)", status: "confirmed" },
      { key: "offerValidity", value: "90 jours", status: "confirmed" },
    ]);

    const out = await commitDossierToDeal({ dossierId, dealId, actorId: ACTOR });
    expect(out.skipped).toEqual([]);

    const [row] = await db.select().from(tender).where(eq(tender.dealId, dealId)).limit(1);
    expect(row?.opensAt?.toISOString()).toContain("2026-09-30");
    expect(row?.submissionPlace).toBe("bureau des marchés de la DD Adrar");
    expect(Number(row?.cautionAmount)).toBe(84200);
    expect(Number(row?.cautionPct)).toBe(1);
    // One fact, two columns — screen 67 reads one and screen 08 the other.
    expect(row?.offerValidityDays).toBe(90);

    const [after] = await db.select().from(deal).where(eq(deal.id, dealId)).limit(1);
    expect(after?.requiredValidityDays).toBe(90);
  });

  it("skips the tender fields on a deal that is not one, and carries the rest", async () => {
    // Losing all five over three would be worse than carrying two. "Make this
    // a tender" is one press away on screen 06, and the screen says so.
    const dealId = await newDeal("Plain enquiry");
    const dossierId = await newDossier([
      { key: "submissionDeadline", value: "2026-09-30T10:00:00", status: "confirmed" },
      { key: "whereToDeposit", value: "bureau des marchés", status: "confirmed" },
      { key: "bidBond", value: "84 200,00 DZD", status: "confirmed" },
    ]);

    const out = await commitDossierToDeal({ dossierId, dealId, actorId: ACTOR });

    expect(out.carried.map((c) => c.key)).toEqual(["submissionDeadline"]);
    expect(out.skipped.map((s) => s.reason).sort()).toEqual(["noTender", "noTender"]);
  });

  it("refuses a validity stated in months rather than inventing a month", async () => {
    // `required_validity_days` counts days. Thirty is the obvious answer and it
    // is wrong twice a year, inside a figure that decides whether our offer
    // still stands.
    const dealId = await newDeal("Validity in months");
    const dossierId = await newDossier([
      { key: "offerValidity", value: "3 mois", status: "confirmed" },
    ]);

    const out = await commitDossierToDeal({ dossierId, dealId, actorId: ACTOR });
    expect(out.skipped).toEqual([{ key: "offerValidity", reason: "unitNotDays" }]);

    const [after] = await db.select().from(deal).where(eq(deal.id, dealId)).limit(1);
    expect(after?.requiredValidityDays).toBeNull();
  });

  it("records the carrying on the dossier and in the audit trail", async () => {
    const dealId = await newDeal("Audited carry");
    const dossierId = await newDossier([
      { key: "latePenalty", value: "1‰ par jour", status: "confirmed" },
    ]);

    await commitDossierToDeal({ dossierId, dealId, actorId: ACTOR });

    const [row] = await db
      .select({ dealId: intakeDossier.dealId })
      .from(intakeDossier)
      .where(eq(intakeDossier.id, dossierId))
      .limit(1);
    expect(row?.dealId).toBe(dealId);

    const all = await db.select().from(auditEntry).where(eq(auditEntry.entityId, dealId));
    const carry = all.find((e) => (e.after as { fromDossier?: string })?.fromDossier === dossierId);
    expect(carry).toBeTruthy();
    expect(carry?.sourceScreen).toBe("40");

    const after = carry?.after as { carried: string[]; filename: string };
    expect(after.carried).toEqual(["latePenalty→deal"]);
    // The document is named in the trail, so "where did this deadline come
    // from" is answerable a year later without opening screen 40.
    expect(after.filename).toContain(".pdf");
  });
});
