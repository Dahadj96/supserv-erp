import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { document, documentLine, documentLink } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import { project, situationDetail } from "@/db/schema/project";
import { computeTotals, lineTotalExcl, RETENTION_BASES, type RetentionBase } from "@/domain/money";
import {
  type ContractLine,
  type Cumulative,
  cumulative,
  type SituationRow,
  situationRows,
} from "./situation";
import { ProjectRefused } from "./store";

/**
 * Situations de travaux, against the database.
 *
 * A situation is a `document` of kind `situation` whose every line points at a
 * line of the project's contract (`source_line_id`), plus a `situation_detail`
 * row for the period and the two dates the client controls. The document
 * engine issues it like any other document — number, snapshot, lock — and
 * `toPdf` draws it in the wilaya's own layout because `render` hands it the
 * cumulative columns from here.
 *
 * What is NOT here: the cumulative figures. They are computed from the issued
 * situations before this one every time they are asked for (LAW 1), and they
 * cannot drift because an issued situation cannot change (LAW 5).
 */

/** The kinds whose issued lines can be a marché's bordereau. */
const CONTRACT_KINDS = ["client_order", "quotation", "proforma"] as const;

export type Contract = {
  documentId: string;
  kind: string;
  number: string | null;
  issuedOn: string | null;
  totalExcl: string;
  lines: ContractLine[];
};

/** A document the project could name as its DQE — for the opening form. */
export type ContractCandidate = Omit<Contract, "lines">;

export async function contractCandidates(dealId: string): Promise<ContractCandidate[]> {
  const rows = await db
    .select({
      documentId: document.id,
      kind: document.kind,
      number: document.number,
      issuedOn: document.issuedOn,
      totalExcl: sql<string>`coalesce(${document.totals}->>'totalExcl', '0')`,
    })
    .from(document)
    .where(
      and(
        eq(document.dealId, dealId),
        eq(document.status, "issued"),
        inArray(document.kind, [...CONTRACT_KINDS]),
      ),
    )
    .orderBy(desc(document.issuedOn), desc(document.createdAt));
  return rows;
}

async function contractLines(documentId: string): Promise<ContractLine[]> {
  const rows = await db
    .select()
    .from(documentLine)
    .where(and(eq(documentLine.documentId, documentId), eq(documentLine.lineKind, "item")))
    .orderBy(asc(documentLine.position));
  return rows
    .filter((line) => !line.isOption)
    .map((line) => ({
      lineId: line.id,
      position: line.position,
      reference: line.reference,
      designation: line.designation,
      unit: line.unit,
      qty: plain(line.qty),
      unitPrice: plain(line.unitPrice),
      vatRate: line.vatRate ?? "0",
    }));
}

/** numeric(16,4) comes back as "400.0000"; a quantity reads as 400. */
function plain(value: string | null): string {
  return new Decimal(value ?? 0).toFixed();
}

/**
 * The project's DQE contractuel.
 *
 * The one a person named when the project was opened; failing that, the
 * client's order, and failing that the offer they accepted — the same
 * preference the opening form shows first. The fallback is not written back:
 * a guess the system made is not a fact somebody confirmed.
 */
export async function contractOf(projectId: string): Promise<Contract | null> {
  const [row] = await db
    .select({ dealId: project.dealId, contractDocumentId: project.contractDocumentId })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!row) return null;

  let chosen: ContractCandidate | undefined;
  const candidates = await contractCandidates(row.dealId);
  if (row.contractDocumentId) {
    chosen = candidates.find((c) => c.documentId === row.contractDocumentId);
    if (!chosen) {
      // Named explicitly, on another enquiry or not issued through this deal —
      // still the contract the person pointed at.
      const [named] = await db
        .select({
          documentId: document.id,
          kind: document.kind,
          number: document.number,
          issuedOn: document.issuedOn,
          totalExcl: sql<string>`coalesce(${document.totals}->>'totalExcl', '0')`,
        })
        .from(document)
        .where(and(eq(document.id, row.contractDocumentId), eq(document.status, "issued")))
        .limit(1);
      chosen = named;
    }
  } else {
    chosen =
      candidates.find((c) => c.kind === "client_order") ??
      candidates.find((c) => c.kind === "quotation") ??
      candidates.find((c) => c.kind === "proforma");
  }
  if (!chosen) return null;

  return { ...chosen, lines: await contractLines(chosen.documentId) };
}

/**
 * What the ISSUED situations of a project before `sequence` already claimed:
 * per contract line, and in total as they were certified.
 */
async function claimedBefore(
  projectId: string,
  sequence: number,
): Promise<{ byLine: Record<string, string>; certifiedExcl: string }> {
  const lines = await db
    .select({
      sourceLineId: documentLine.sourceLineId,
      qty: sql<string>`coalesce(sum(${documentLine.qty}), 0)::text`,
    })
    .from(documentLine)
    .innerJoin(document, eq(document.id, documentLine.documentId))
    .innerJoin(situationDetail, eq(situationDetail.documentId, document.id))
    .where(
      and(
        eq(situationDetail.projectId, projectId),
        lt(situationDetail.sequence, sequence),
        eq(document.status, "issued"),
      ),
    )
    .groupBy(documentLine.sourceLineId);

  const [certified] = await db
    .select({
      total: sql<string>`coalesce(sum((${document.totals}->>'totalExcl')::numeric), 0)::text`,
    })
    .from(document)
    .innerJoin(situationDetail, eq(situationDetail.documentId, document.id))
    .where(
      and(
        eq(situationDetail.projectId, projectId),
        lt(situationDetail.sequence, sequence),
        eq(document.status, "issued"),
      ),
    );

  const byLine: Record<string, string> = {};
  for (const row of lines) if (row.sourceLineId) byLine[row.sourceLineId] = row.qty;
  return { byLine, certifiedExcl: certified?.total ?? "0" };
}

export type NextSituation = {
  projectId: string;
  contract: Contract | null;
  /** The draft still open, which the form edits instead of opening another. */
  draft: {
    documentId: string;
    sequence: number;
    periodFrom: string | null;
    periodTo: string | null;
    workDone: string | null;
    advanceRecovered: string;
    period: Record<string, string>;
  } | null;
  sequence: number;
  retentionPct: string;
  retentionBase: RetentionBase | null;
  rows: SituationRow[];
  previouslyCertifiedExcl: string;
  /** Why nothing can be raised, when nothing can. */
  blocked: "noContract" | "retentionBaseRequired" | "previousNotIssued" | null;
};

/** What the next situation would look like — the form's own data. */
export async function nextSituation(projectId: string): Promise<NextSituation | null> {
  const [row] = await db.select().from(project).where(eq(project.id, projectId)).limit(1);
  if (!row) return null;

  const contract = await contractOf(projectId);

  const existing = await db
    .select({
      documentId: situationDetail.documentId,
      sequence: situationDetail.sequence,
      status: document.status,
      periodFrom: situationDetail.periodFrom,
      periodTo: situationDetail.periodTo,
      workDone: situationDetail.workDone,
      advanceDeducted: document.advanceDeducted,
    })
    .from(situationDetail)
    .innerJoin(document, eq(document.id, situationDetail.documentId))
    .where(eq(situationDetail.projectId, projectId))
    .orderBy(asc(situationDetail.sequence));

  const open = existing.find((s) => s.status === "draft");
  const sequence = open?.sequence ?? (existing.at(-1)?.sequence ?? 0) + 1;

  const period: Record<string, string> = {};
  if (open) {
    const lines = await db
      .select({ sourceLineId: documentLine.sourceLineId, qty: documentLine.qty })
      .from(documentLine)
      .where(eq(documentLine.documentId, open.documentId));
    for (const line of lines) if (line.sourceLineId) period[line.sourceLineId] = plain(line.qty);
  }

  const before = await claimedBefore(projectId, sequence);
  const retentionBase = asBase(row.retentionBase);

  const blocked = !contract
    ? "noContract"
    : Number(row.retentionPct) > 0 && !retentionBase
      ? "retentionBaseRequired"
      : existing.some((s) => s.sequence < sequence && s.status !== "issued")
        ? "previousNotIssued"
        : null;

  return {
    projectId,
    contract,
    draft: open
      ? {
          documentId: open.documentId,
          sequence: open.sequence,
          periodFrom: open.periodFrom,
          periodTo: open.periodTo,
          workDone: open.workDone,
          advanceRecovered: open.advanceDeducted ?? "0",
          period,
        }
      : null,
    sequence,
    retentionPct: row.retentionPct,
    retentionBase,
    rows: situationRows({ contract: contract?.lines ?? [], previous: before.byLine, period }),
    previouslyCertifiedExcl: before.certifiedExcl,
    blocked,
  };
}

function asBase(value: string | null): RetentionBase | null {
  return (RETENTION_BASES as readonly string[]).includes(value ?? "")
    ? (value as RetentionBase)
    : null;
}

export type SituationInput = {
  projectId: string;
  /** contract lineId → quantity claimed this period. Zero and blank are dropped. */
  quantities: Record<string, string>;
  periodFrom: string | null;
  periodTo: string | null;
  workDone: string | null;
  /** Remboursement d'avance this period — the amount, as the CCAP schedules it. */
  advanceRecovered: string;
  /** The date on the paper. Today unless said otherwise. */
  issuedOn: string | null;
  actorId: string;
};

/**
 * Raise the next situation as a DRAFT, or rewrite the one still open.
 *
 * Refuses, in the order a person would hit them: no contract to bill against,
 * a retention whose base nobody has read off the CCAP, an earlier situation
 * still unissued (its quantities would be missing from "cumul précédent"),
 * a line that is not on the contract, and nothing claimed at all.
 */
export async function saveSituation(input: SituationInput): Promise<string> {
  const next = await nextSituation(input.projectId);
  if (!next) throw new ProjectRefused("noSuchProject");
  if (next.blocked) throw new ProjectRefused(next.blocked);
  const contract = next.contract as Contract;

  const wanted = Object.entries(input.quantities).filter(([, qty]) => Number(qty) > 0);
  if (wanted.length === 0) throw new ProjectRefused("nothingClaimed");
  for (const [lineId] of wanted) {
    if (!contract.lines.some((line) => line.lineId === lineId)) {
      throw new ProjectRefused("lineNotOnContract");
    }
  }

  const [row] = await db
    .select({
      partyId: project.partyId,
      dealId: project.dealId,
      currency: project.currency,
      retentionPct: project.retentionPct,
    })
    .from(project)
    .where(eq(project.id, input.projectId))
    .limit(1);
  if (!row) throw new ProjectRefused("noSuchProject");

  const [client] = await db
    .select({ docLocale: party.docLocale })
    .from(party)
    .where(eq(party.id, row.partyId))
    .limit(1);

  const chosen = wanted.map(([lineId, qty]) => ({
    line: contract.lines.find((l) => l.lineId === lineId) as ContractLine,
    qty,
  }));

  const advanceRecovered = Number(input.advanceRecovered) > 0 ? input.advanceRecovered : "0";
  const totals = computeTotals(
    chosen.map(({ line, qty }) => ({ qty, unitPrice: line.unitPrice, vatRate: line.vatRate })),
    {
      advanceDeducted: advanceRecovered,
      retentionPct: row.retentionPct,
      retentionBase: next.retentionBase,
    },
  );

  const lines = chosen.map(({ line, qty }, index) => ({
    position: index + 1,
    lineKind: "item",
    sourceLineId: line.lineId,
    reference: line.reference,
    designation: line.designation,
    unit: line.unit,
    qty,
    unitPrice: line.unitPrice,
    vatRate: line.vatRate,
    totalExcl: lineTotalExcl({ qty, unitPrice: line.unitPrice }).toFixed(2),
  }));

  return db.transaction(async (tx) => {
    let documentId: string;

    if (next.draft) {
      documentId = next.draft.documentId;
      await tx
        .update(document)
        .set({
          issuedOn: input.issuedOn ?? undefined,
          advanceDeducted: advanceRecovered,
          retentionPct: row.retentionPct,
          totals,
        })
        .where(eq(document.id, documentId));
      await tx.delete(documentLine).where(eq(documentLine.documentId, documentId));
      await tx
        .update(situationDetail)
        .set({ periodFrom: input.periodFrom, periodTo: input.periodTo, workDone: input.workDone })
        .where(eq(situationDetail.documentId, documentId));
    } else {
      const [created] = await tx
        .insert(document)
        .values({
          kind: "situation",
          number: null,
          partyId: row.partyId,
          dealId: row.dealId,
          locale: client?.docLocale ?? "fr",
          currency: row.currency,
          issuedOn: input.issuedOn ?? new Date().toISOString().slice(0, 10),
          status: "draft",
          // A wilaya pays by transfer; a situation settled in cash is not a
          // thing, and the droit de timbre therefore never applies here.
          settlement: "virement",
          advanceDeducted: advanceRecovered,
          retentionPct: row.retentionPct,
          totals,
        })
        .returning({ id: document.id });
      documentId = created?.id as string;

      await tx.insert(situationDetail).values({
        documentId,
        projectId: input.projectId,
        sequence: next.sequence,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        workDone: input.workDone,
      });

      // `covers`, as an invoice covers an order: the contract is billed in
      // parts and is not replaced by any one of them.
      await tx.insert(documentLink).values({
        fromDocument: documentId,
        toDocument: contract.documentId,
        relation: "covers",
      });
    }

    await tx.insert(documentLine).values(lines.map((line) => ({ ...line, documentId })));

    await tx.insert(auditEntry).values({
      actorId: input.actorId,
      actorKind: "user",
      entity: "document",
      entityId: documentId,
      action: next.draft ? "edit" : "create",
      after: {
        kind: "situation",
        projectId: input.projectId,
        sequence: next.sequence,
        contract: contract.documentId,
        lines: lines.length,
        totals,
      },
      sourceScreen: "16",
    });

    return documentId;
  });
}

export type SituationView = {
  documentId: string;
  projectId: string;
  projectCode: string;
  object: string;
  contractRef: string | null;
  wilaya: string | null;
  contractExcl: string | null;
  contract: { documentId: string; number: string | null; kind: string };
  sequence: number;
  periodFrom: string | null;
  periodTo: string | null;
  workDone: string | null;
  submittedOn: string | null;
  approvedOn: string | null;
  approvedBy: string | null;
  retentionPct: string;
  retentionBase: RetentionBase | null;
  rows: SituationRow[];
  cumulative: Cumulative;
};

/** Everything the form prints beyond what the document itself stores. */
export async function situationOf(documentId: string): Promise<SituationView | null> {
  const [detail] = await db
    .select({
      projectId: situationDetail.projectId,
      sequence: situationDetail.sequence,
      periodFrom: situationDetail.periodFrom,
      periodTo: situationDetail.periodTo,
      workDone: situationDetail.workDone,
      submittedOn: situationDetail.submittedOn,
      approvedOn: situationDetail.approvedOn,
      approvedBy: situationDetail.approvedBy,
      code: project.code,
      object: project.object,
      contractRef: project.contractRef,
      wilaya: project.wilaya,
      amountExcl: project.amountExcl,
      retentionPct: project.retentionPct,
      retentionBase: project.retentionBase,
    })
    .from(situationDetail)
    .innerJoin(project, eq(project.id, situationDetail.projectId))
    .where(eq(situationDetail.documentId, documentId))
    .limit(1);
  if (!detail) return null;

  const contract = await contractOf(detail.projectId);
  if (!contract) return null;

  const lines = await db
    .select({ sourceLineId: documentLine.sourceLineId, qty: documentLine.qty })
    .from(documentLine)
    .where(eq(documentLine.documentId, documentId));
  const period: Record<string, string> = {};
  for (const line of lines) if (line.sourceLineId) period[line.sourceLineId] = plain(line.qty);

  const before = await claimedBefore(detail.projectId, detail.sequence);
  const rows = situationRows({ contract: contract.lines, previous: before.byLine, period });

  return {
    documentId,
    projectId: detail.projectId,
    projectCode: detail.code,
    object: detail.object,
    contractRef: detail.contractRef,
    wilaya: detail.wilaya,
    contractExcl: detail.amountExcl,
    contract: { documentId: contract.documentId, number: contract.number, kind: contract.kind },
    sequence: detail.sequence,
    periodFrom: detail.periodFrom,
    periodTo: detail.periodTo,
    workDone: detail.workDone,
    submittedOn: detail.submittedOn,
    approvedOn: detail.approvedOn,
    approvedBy: detail.approvedBy,
    retentionPct: detail.retentionPct,
    retentionBase: asBase(detail.retentionBase),
    rows,
    cumulative: cumulative({
      rows,
      previouslyCertifiedExcl: before.certifiedExcl,
      contractExcl: detail.amountExcl,
    }),
  };
}

/**
 * The two dates the client controls.
 *
 * Submitted is when the paper left; approved is when their engineer signed it,
 * which is a different day and the one that starts the payment clock. Both
 * are recorded on an ISSUED situation only — a draft has not been anywhere.
 */
export async function recordSituationSubmitted(opts: {
  documentId: string;
  on: string;
  actorId: string;
}): Promise<void> {
  await assertIssuedSituation(opts.documentId);
  await db.transaction(async (tx) => {
    await tx
      .update(situationDetail)
      .set({ submittedOn: opts.on })
      .where(eq(situationDetail.documentId, opts.documentId));
    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "document",
      entityId: opts.documentId,
      action: "update",
      after: { submittedOn: opts.on },
      sourceScreen: "16",
    });
  });
}

export async function recordSituationApproved(opts: {
  documentId: string;
  on: string;
  by: string | null;
  actorId: string;
}): Promise<void> {
  const detail = await assertIssuedSituation(opts.documentId);
  if (!detail.submittedOn) throw new ProjectRefused("notSubmitted");
  await db.transaction(async (tx) => {
    await tx
      .update(situationDetail)
      .set({ approvedOn: opts.on, approvedBy: opts.by })
      .where(eq(situationDetail.documentId, opts.documentId));
    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "document",
      entityId: opts.documentId,
      action: "update",
      after: { approvedOn: opts.on, approvedBy: opts.by },
      sourceScreen: "16",
    });
  });
}

async function assertIssuedSituation(documentId: string) {
  const [row] = await db
    .select({ status: document.status, submittedOn: situationDetail.submittedOn })
    .from(situationDetail)
    .innerJoin(document, eq(document.id, situationDetail.documentId))
    .where(eq(situationDetail.documentId, documentId))
    .limit(1);
  if (!row) throw new ProjectRefused("noSuchSituation");
  if (row.status !== "issued") throw new ProjectRefused("notIssued");
  return row;
}

/**
 * Whether a situation may be issued now: every earlier one on its project
 * must already be issued, or its "cumul précédent" would be missing them and
 * the client would certify a figure that changes the day the earlier one goes
 * out. The engine asks this before it reserves a number.
 */
export async function earlierSituationUnissued(documentId: string): Promise<boolean> {
  const [mine] = await db
    .select({ projectId: situationDetail.projectId, sequence: situationDetail.sequence })
    .from(situationDetail)
    .where(eq(situationDetail.documentId, documentId))
    .limit(1);
  if (!mine) return false;

  const [earlier] = await db
    .select({ id: document.id })
    .from(situationDetail)
    .innerJoin(document, eq(document.id, situationDetail.documentId))
    .where(
      and(
        eq(situationDetail.projectId, mine.projectId),
        lt(situationDetail.sequence, mine.sequence),
        sql`${document.status} <> 'issued'`,
      ),
    )
    .limit(1);
  return Boolean(earlier);
}
