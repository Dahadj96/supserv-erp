import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { document, documentLine, documentLink } from "@/db/schema/document";
import { paymentAllocation } from "@/db/schema/money";
import { party } from "@/db/schema/party";
import { project, situationDetail } from "@/db/schema/project";
import { peekNumber } from "@/documents/numbering";
import type { Totals } from "@/domain/money";
import { type FinalAccount, type FinalAccountSituation, finalAccountOf } from "./final-account";
import { contractOf } from "./situations";
import { getProject, ProjectRefused } from "./store";

/**
 * Screen 16d — the décompte final, against the database.
 *
 * `finalAccountOf` does the arithmetic and is pure. This gathers the facts it
 * needs — every situation of the project with what it certified, withheld and
 * recovered, and what has been paid against it — and writes the result as a
 * draft document nobody has to type.
 *
 * There is one open draft at a time, for the reason there is one open
 * situation: two décomptes over the same marché cannot both be the final one.
 */

export type NextFinalAccount = {
  projectId: string;
  currency: string;
  account: FinalAccount;
  /** The décompte still open, which the screen rewrites instead of opening another. */
  draft: { documentId: string; issuedOn: string | null } | null;
  /** One is already issued: the marché is closed and this screen is a record. */
  issued: { documentId: string; number: string | null; issuedOn: string | null } | null;
  /**
   * What the number WOULD be. Null when nobody has created the series on
   * screen 50 — which is a refusal at issue, so the screen says it first.
   */
  nextNumber: string | null;
};

async function situationsOf(projectId: string): Promise<FinalAccountSituation[]> {
  const rows = await db
    .select({
      sequence: situationDetail.sequence,
      number: document.number,
      issuedOn: document.issuedOn,
      approvedOn: situationDetail.approvedOn,
      status: document.status,
      excl: sql<string>`coalesce(${document.totals}->>'totalExcl', '0')`,
      vat: sql<string>`coalesce(${document.totals}->>'totalVat', '0')`,
      incl: sql<string>`coalesce(${document.totals}->>'totalIncl', '0')`,
      retention: sql<string>`coalesce(${document.totals}->>'retention', '0')`,
      advanceDeducted: sql<string>`coalesce(${document.totals}->>'advanceDeducted', '0')`,
      paid: sql<string>`(
        select coalesce(sum(${paymentAllocation.amount}), 0)::text
        from ${paymentAllocation}
        where ${paymentAllocation.documentId} = ${document.id}
      )`,
    })
    .from(situationDetail)
    .innerJoin(document, eq(document.id, situationDetail.documentId))
    .where(eq(situationDetail.projectId, projectId))
    .orderBy(asc(situationDetail.sequence));
  return rows;
}

export async function nextFinalAccount(projectId: string): Promise<NextFinalAccount | null> {
  const p = await getProject(projectId);
  if (!p) return null;

  const account = finalAccountOf({
    situations: await situationsOf(projectId),
    pvProvisoireOn: p.pvProvisoireOn,
    // The clause's own figure, or nothing at all. A décompte that invented a
    // penalty would be this company docking its own final payment.
    penalty: p.penalty.blocked ? null : p.penalty.amount,
    // Nothing releases the retention yet — screen 16 records the PV définitif
    // and the release is a payment of its own. Until then it is all still held.
    retentionReleased: "0",
  });

  return {
    projectId,
    currency: p.currency,
    account,
    draft: await draftFor(projectId),
    issued: await issuedFor(projectId),
    nextNumber: await peekNumber("final_account"),
  };
}

/**
 * The link is to the CONTRACT, not to the project: `document_link` joins two
 * documents, and the marché is the document a décompte closes.
 */
async function linkTarget(projectId: string): Promise<string | null> {
  const contract = await contractOf(projectId);
  return contract?.documentId ?? null;
}

async function draftFor(projectId: string) {
  const target = await linkTarget(projectId);
  if (!target) return null;
  const row = await oneDecompte(target, "draft");
  return row ? { documentId: row.id, issuedOn: row.issuedOn } : null;
}

async function issuedFor(projectId: string) {
  const target = await linkTarget(projectId);
  if (!target) return null;
  const row = await oneDecompte(target, "issued");
  return row ? { documentId: row.id, number: row.number, issuedOn: row.issuedOn } : null;
}

async function oneDecompte(contractDocumentId: string, status: "draft" | "issued") {
  const [row] = await db
    .select({ id: document.id, number: document.number, issuedOn: document.issuedOn })
    .from(document)
    .innerJoin(documentLink, eq(documentLink.fromDocument, document.id))
    .where(
      and(
        eq(document.kind, "final_account"),
        eq(document.status, status),
        eq(documentLink.toDocument, contractDocumentId),
        eq(documentLink.relation, "closes"),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Write the décompte final as a DRAFT, or rewrite the one still open.
 *
 * Every figure comes from `finalAccountOf`; the caller passes a date and
 * nothing else. The lines are the situations themselves — one per paper, in
 * order, with its own number and date — because a décompte a wilaya can check
 * is one that names the documents it adds up.
 */
export async function saveFinalAccount(opts: {
  projectId: string;
  issuedOn: string | null;
  actorId: string;
}): Promise<string> {
  const next = await nextFinalAccount(opts.projectId);
  if (!next) throw new ProjectRefused("noSuchProject");
  if (next.account.blocked) throw new ProjectRefused(next.account.blocked);
  if (next.issued) throw new ProjectRefused("alreadyClosed");

  const target = await linkTarget(opts.projectId);
  if (!target) throw new ProjectRefused("noContract");

  const [row] = await db
    .select({ partyId: project.partyId, dealId: project.dealId, currency: project.currency })
    .from(project)
    .where(eq(project.id, opts.projectId))
    .limit(1);
  if (!row) throw new ProjectRefused("noSuchProject");

  const [client] = await db
    .select({ docLocale: party.docLocale })
    .from(party)
    .where(eq(party.id, row.partyId))
    .limit(1);

  const a = next.account;

  // Hand-built rather than `computeTotals`: two of these figures are not
  // arithmetic over lines at all. The penalty is what the CCAP allows the
  // client to apply, and what has been paid is a fact of the payment register.
  const totals: Totals = {
    totalExcl: a.worksExcl,
    discountTotal: "0.00",
    vatByRate: {},
    totalVat: a.worksVat,
    stampDuty: "0.00",
    totalIncl: a.worksIncl,
    advanceDeducted: a.advanceRecovered,
    retention: a.retentionHeld,
    penalty: a.penalty,
    alreadyPaid: a.paid,
    dueNow: a.balance,
    optionsExcl: "0.00",
  };

  const lines = a.counted.map((s, index) => ({
    position: index + 1,
    lineKind: "item",
    reference: s.number,
    // The paper as its own file names it: "Situation n° 2 du 02/09/2026 —
    // SIT-2026-071". A décompte a wilaya can check is one that names what it
    // adds up, in the words their own copy carries.
    designation: [
      `Situation n° ${s.sequence}`,
      s.issuedOn ? ` du ${s.issuedOn.split("-").reverse().join("/")}` : "",
      s.number ? ` — ${s.number}` : "",
    ].join(""),
    unit: null,
    qty: "1",
    unitPrice: s.excl,
    // The rate this situation actually carried, so the line's own arithmetic
    // reads true even though the document's VAT total is the sum of theirs.
    vatRate: Number(s.excl) > 0 ? ((Number(s.vat) / Number(s.excl)) * 100).toFixed(2) : "0",
    totalExcl: s.excl,
  }));

  return db.transaction(async (tx) => {
    let documentId: string;

    if (next.draft) {
      documentId = next.draft.documentId;
      await tx
        .update(document)
        .set({ issuedOn: opts.issuedOn ?? undefined, totals })
        .where(eq(document.id, documentId));
      await tx.delete(documentLine).where(eq(documentLine.documentId, documentId));
    } else {
      const [created] = await tx
        .insert(document)
        .values({
          kind: "final_account",
          number: null,
          partyId: row.partyId,
          dealId: row.dealId,
          locale: client?.docLocale ?? "fr",
          currency: row.currency,
          issuedOn: opts.issuedOn ?? new Date().toISOString().slice(0, 10),
          status: "draft",
          settlement: "virement",
          totals,
        })
        .returning({ id: document.id });
      documentId = created?.id as string;

      // `closes`, because that is what it does: the marché is billed in parts
      // and this is the paper that says there are no more parts.
      await tx.insert(documentLink).values({
        fromDocument: documentId,
        toDocument: target,
        relation: "closes",
      });
    }

    if (lines.length > 0) {
      await tx.insert(documentLine).values(lines.map((line) => ({ ...line, documentId })));
    }

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "document",
      entityId: documentId,
      action: next.draft ? "edit" : "create",
      after: {
        kind: "final_account",
        projectId: opts.projectId,
        closes: target,
        situations: a.counted.length,
        balance: a.balance,
        penalty: a.penalty,
      },
      sourceScreen: "16",
    });

    return documentId;
  });
}
