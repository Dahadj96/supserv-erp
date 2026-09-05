import Decimal from "decimal.js";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { document, documentLine, documentLink } from "@/db/schema/document";
import { paymentAllocation } from "@/db/schema/money";
import { party } from "@/db/schema/party";
import { project, situationDetail } from "@/db/schema/project";
import { peekNumber } from "@/documents/numbering";
import { computeTotals, lineTotalExcl } from "@/domain/money";
import { contractDocumentIdOf } from "./situations";
import { getProject, type ProjectDetail, ProjectRefused } from "./store";

/**
 * Screen 16e — the retenue de garantie coming back.
 *
 * The last money on a marché, and the easiest to lose: five per cent of every
 * situation, withheld for a year after the réception, given back when the
 * client is asked for it. Nobody is invoiced automatically and no client
 * volunteers it — it comes back because somebody wrote and asked.
 *
 * Until this existed the ERP could see the money (screen 16 says what is held
 * and when it is due) and could not follow it: a marché stayed in WARRANTY for
 * ever, because the only thing that ends the warranty is the retention
 * arriving and there was nothing for it to arrive against.
 *
 * The paper re-charges NO VAT. The tax was paid on the situations; this asks
 * for a part of a sum already invoiced, listed situation by situation so the
 * client's own accountant can tick it off against their file.
 */

export type RetentionRow = {
  sequence: number;
  number: string | null;
  issuedOn: string | null;
  /** What this situation withheld. */
  retention: string;
};

export type NextRetentionRelease = {
  projectId: string;
  currency: string;
  rows: RetentionRow[];
  /** Withheld across every issued situation. */
  held: string;
  /** Already asked for on a release that has been issued. */
  asked: string;
  /** Actually back — allocations against those releases. */
  returned: string;
  /** What this one would ask for: held less what has already been asked. */
  toAsk: string;
  /** The PV that entitles us to ask, and when the warranty runs out. */
  pvDefinitiveOn: string | null;
  releaseDueOn: string | null;
  contractDocumentId: string | null;
  draft: { documentId: string; issuedOn: string | null } | null;
  issued: { documentId: string; number: string | null; issuedOn: string | null }[];
  nextNumber: string | null;
  /**
   * Why nothing can be asked for. `noDefinitive` is the one that matters: the
   * réception définitive is what entitles us to the money, and a demand sent
   * before it is a demand the client files.
   */
  blocked: "noRetention" | "noDefinitive" | "allAsked" | "noContract" | null;
};

function d(value: string | null | undefined): Decimal {
  return new Decimal(value ?? "0");
}

/** The retention each ISSUED situation of a project withheld. */
async function withheldBy(projectId: string): Promise<RetentionRow[]> {
  const rows = await db
    .select({
      sequence: situationDetail.sequence,
      number: document.number,
      issuedOn: document.issuedOn,
      retention: sql<string>`coalesce(${document.totals}->>'retention', '0')`,
    })
    .from(situationDetail)
    .innerJoin(document, eq(document.id, situationDetail.documentId))
    .where(and(eq(situationDetail.projectId, projectId), eq(document.status, "issued")))
    .orderBy(asc(situationDetail.sequence));
  return rows.filter((row) => d(row.retention).greaterThan(0));
}

/**
 * What has come back, per project, for many projects at once.
 *
 * Money ARRIVING is what ends a warranty — not a document being issued. A
 * demand sitting unanswered on a wilaya's desk for eight months is exactly the
 * state screen 15 is meant to make visible, and calling the project closed
 * because we asked would hide it.
 *
 * Three queries whatever the number of projects, for the reason
 * `amendmentDeltas` is: screen 15 draws every marché at once.
 */
export async function retentionReturned(projectIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (projectIds.length === 0) return out;

  const projects = await db
    .select({ projectId: project.id, contractId: project.contractDocumentId })
    .from(project)
    .where(inArray(project.id, projectIds));
  const contractIds = projects.map((p) => p.contractId).filter((id): id is string => Boolean(id));
  if (contractIds.length === 0) return out;

  const releases = await db
    .select({
      contractId: documentLink.toDocument,
      documentId: document.id,
      paid: sql<string>`coalesce((
        select sum(${paymentAllocation.amount})
        from ${paymentAllocation}
        where ${paymentAllocation.documentId} = ${document.id}
      ), 0)::text`,
    })
    .from(document)
    .innerJoin(documentLink, eq(documentLink.fromDocument, document.id))
    .where(
      and(
        eq(document.kind, "retention_release"),
        eq(document.status, "issued"),
        inArray(documentLink.toDocument, contractIds),
        eq(documentLink.relation, "releases"),
      ),
    );
  if (releases.length === 0) return out;

  const byContract = new Map<string, Decimal>();
  for (const row of releases) {
    const at = byContract.get(row.contractId) ?? new Decimal(0);
    byContract.set(row.contractId, at.plus(d(row.paid)));
  }

  for (const p of projects) {
    const back = p.contractId ? byContract.get(p.contractId) : undefined;
    if (back && back.greaterThan(0)) out.set(p.projectId, back.toFixed(2));
  }
  return out;
}

async function releasesOf(contractDocumentId: string, status: "draft" | "issued") {
  return db
    .select({
      id: document.id,
      number: document.number,
      issuedOn: document.issuedOn,
      total: sql<string>`coalesce(${document.totals}->>'totalIncl', '0')`,
    })
    .from(document)
    .innerJoin(documentLink, eq(documentLink.fromDocument, document.id))
    .where(
      and(
        eq(document.kind, "retention_release"),
        eq(document.status, status),
        eq(documentLink.toDocument, contractDocumentId),
        eq(documentLink.relation, "releases"),
      ),
    )
    .orderBy(asc(document.issuedOn));
}

export async function nextRetentionRelease(
  projectId: string,
  loaded?: ProjectDetail | null,
): Promise<NextRetentionRelease | null> {
  const p = loaded ?? (await getProject(projectId));
  if (!p) return null;

  const rows = await withheldBy(projectId);
  const held = rows.reduce((sum, row) => sum.plus(d(row.retention)), new Decimal(0));

  const contractDocumentId = await contractDocumentIdOf(projectId);
  const drafts = contractDocumentId ? await releasesOf(contractDocumentId, "draft") : [];
  const issued = contractDocumentId ? await releasesOf(contractDocumentId, "issued") : [];

  const asked = issued.reduce((sum, one) => sum.plus(d(one.total)), new Decimal(0));
  const returned = d((await retentionReturned([projectId])).get(projectId));
  const toAsk = Decimal.max(held.minus(asked), 0);

  const blocked: NextRetentionRelease["blocked"] = !contractDocumentId
    ? "noContract"
    : held.lessThanOrEqualTo(0)
      ? "noRetention"
      : !p.pvDefinitiveOn
        ? "noDefinitive"
        : toAsk.lessThanOrEqualTo(0)
          ? "allAsked"
          : null;

  const draft = drafts[0];

  return {
    projectId,
    currency: p.currency,
    rows,
    held: held.toFixed(2),
    asked: asked.toFixed(2),
    returned: returned.toFixed(2),
    toAsk: toAsk.toFixed(2),
    pvDefinitiveOn: p.pvDefinitiveOn,
    releaseDueOn: p.retentionReleases.on,
    contractDocumentId,
    draft: draft ? { documentId: draft.id, issuedOn: draft.issuedOn } : null,
    issued: issued.map((one) => ({
      documentId: one.id,
      number: one.number,
      issuedOn: one.issuedOn,
    })),
    nextNumber: await peekNumber("retention_release"),
    blocked,
  };
}

/**
 * Write the demande de restitution as a DRAFT, or rewrite the one still open.
 *
 * One line per situation, naming it and what it withheld, because a client's
 * accountant checks this against their own file and "retenue de garantie —
 * 138 260" is a figure they have to take on trust.
 */
export async function saveRetentionRelease(opts: {
  projectId: string;
  issuedOn: string | null;
  actorId: string;
}): Promise<string> {
  const next = await nextRetentionRelease(opts.projectId);
  if (!next) throw new ProjectRefused("noSuchProject");
  if (next.blocked) throw new ProjectRefused(next.blocked);
  const target = next.contractDocumentId as string;

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

  const lines = next.rows.map((s, index) => ({
    position: index + 1,
    lineKind: "item",
    reference: s.number,
    designation: [
      `Retenue de garantie — situation n° ${s.sequence}`,
      s.issuedOn ? ` du ${s.issuedOn.split("-").reverse().join("/")}` : "",
      s.number ? ` (${s.number})` : "",
    ].join(""),
    unit: null,
    qty: "1",
    unitPrice: s.retention,
    // No VAT. It was paid on the situation this sum was withheld from, and
    // charging it again would be charging the client twice for one tax.
    vatRate: "0",
    totalExcl: lineTotalExcl({ qty: "1", unitPrice: s.retention }).toFixed(2),
  }));

  const totals = computeTotals(
    lines.map((line) => ({ qty: line.qty, unitPrice: line.unitPrice, vatRate: line.vatRate })),
  );

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
          kind: "retention_release",
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

      await tx.insert(documentLink).values({
        fromDocument: documentId,
        toDocument: target,
        relation: "releases",
      });
    }

    await tx.insert(documentLine).values(lines.map((line) => ({ ...line, documentId })));

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "document",
      entityId: documentId,
      action: next.draft ? "edit" : "create",
      after: {
        kind: "retention_release",
        projectId: opts.projectId,
        releases: target,
        situations: next.rows.length,
        asks: totals.totalIncl,
        pvDefinitiveOn: next.pvDefinitiveOn,
      },
      sourceScreen: "16",
    });

    return documentId;
  });
}
