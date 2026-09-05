import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { document, documentLine, documentLink } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import { amendmentDetail, project, situationDetail } from "@/db/schema/project";
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

export type Amendment = {
  documentId: string;
  /** Theirs — "avenant n° 2" is what the form prints. */
  number: string | null;
  issuedOn: string | null;
  /** What it adds to the marché, excluding VAT. Negative when it takes away. */
  deltaExcl: string;
  /** How many bordereau lines it changed, and how many it added. */
  changed: number;
  added: number;
};

export type Contract = {
  documentId: string;
  kind: string;
  number: string | null;
  issuedOn: string | null;
  totalExcl: string;
  /** The marché's own lines, amended by every issued avenant, in order. */
  lines: ContractLine[];
  /** The avenants, oldest first. Empty on a marché nobody has changed. */
  amendments: Amendment[];
};

/** A document the project could name as its DQE — for the opening form. */
export type ContractCandidate = Omit<Contract, "lines" | "amendments">;

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

/** The marché's stated value plus every avenant's delta. Null stays null. */
export function withAmendments(amountExcl: string | null, amendments: Amendment[]): string | null {
  if (!amountExcl) return null;
  return amendments
    .reduce((sum, one) => sum.plus(one.deltaExcl), new Decimal(amountExcl))
    .toFixed(2);
}

function amountOf(lines: ContractLine[]): Decimal {
  return lines.reduce(
    (sum, line) => sum.plus(new Decimal(line.qty).times(line.unitPrice)),
    new Decimal(0),
  );
}

/**
 * The marché as its avenants left it.
 *
 * An avenant's line either points at a line of the marché — `source_line_id`,
 * the same link a delivery note uses — and REPLACES its quantity and price, or
 * points at nothing and ADDS a price to the bordereau. Applied oldest first,
 * so avenant 2 wins over avenant 1 on a line both touch.
 *
 * The composed lines keep the ORIGINAL line's id where one was amended. That
 * is deliberate: situations already issued point at the marché's lines through
 * `source_line_id`, and changing the identity of a line under them would break
 * every cumulative column on paper the client has already signed. An avenant
 * changes what a line says, not which line it is.
 */
type AmendmentLine = typeof documentLine.$inferSelect;

type Composed = {
  lines: ContractLine[];
  perAmendment: Map<string, { changed: number; added: number }>;
  /**
   * What each avenant, applied in its turn, added to the bordereau. The
   * running total after it, less the running total before it — which is what
   * its own paper says, and it comes out of the SAME pass rather than one
   * composition per avenant.
   */
  deltas: Map<string, string>;
};

/**
 * The composition itself, with the rows already in hand. PURE.
 *
 * It is separate from the query because the same arithmetic is done for one
 * project on screen 16 and for thirty on screen 15, and doing it here means
 * the list screen reads every avenant's lines in one query instead of one
 * round trip per avenant per project.
 */
function composeLines(
  base: ContractLine[],
  amendmentIds: string[],
  rows: AmendmentLine[],
): Composed {
  const perAmendment = new Map<string, { changed: number; added: number }>();
  const deltas = new Map<string, string>();
  if (amendmentIds.length === 0) return { lines: base, perAmendment, deltas };

  const lines = [...base];
  let running = amountOf(lines);

  for (const id of amendmentIds) {
    const tally = { changed: 0, added: 0 };
    for (const row of rows.filter((r) => r.documentId === id && !r.isOption)) {
      const at = row.sourceLineId
        ? lines.findIndex((line) => line.lineId === row.sourceLineId)
        : -1;
      if (at >= 0) {
        const previous = lines[at] as ContractLine;
        lines[at] = {
          ...previous,
          // Only what the avenant states. A line whose price it left blank
          // keeps the marché's price; the paper changed a quantity, not both.
          qty: row.qty === null ? previous.qty : plain(row.qty),
          unitPrice: row.unitPrice === null ? previous.unitPrice : plain(row.unitPrice),
          designation: row.designation ?? previous.designation,
        };
        tally.changed += 1;
      } else {
        lines.push({
          lineId: row.id,
          position: lines.length + 1,
          reference: row.reference,
          designation: row.designation,
          unit: row.unit,
          qty: plain(row.qty),
          unitPrice: plain(row.unitPrice),
          vatRate: row.vatRate ?? "0",
        });
        tally.added += 1;
      }
    }
    perAmendment.set(id, tally);
    const after = amountOf(lines);
    deltas.set(id, after.minus(running).toFixed(2));
    running = after;
  }
  return { lines, perAmendment, deltas };
}

/** The composition, with one query for every avenant's lines together. */
async function amendedLines(base: ContractLine[], amendmentIds: string[]): Promise<Composed> {
  if (amendmentIds.length === 0) return composeLines(base, [], []);
  const rows = await db
    .select()
    .from(documentLine)
    .where(and(inArray(documentLine.documentId, amendmentIds), eq(documentLine.lineKind, "item")))
    .orderBy(asc(documentLine.position));
  return composeLines(base, amendmentIds, rows);
}

/**
 * The issued avenants on a marché, oldest first.
 *
 * `asOf` is the date the reader is standing on. A situation issued in August
 * was signed against the marché as it stood in August, and re-printing it in
 * November must not show it a quantity an avenant changed afterwards — the
 * paper the client holds would no longer match ours. Undefined means today:
 * every avenant there is.
 */
async function amendmentsOf(contractDocumentId: string, asOf?: string | null) {
  return db
    .select({
      documentId: document.id,
      number: document.number,
      issuedOn: document.issuedOn,
    })
    .from(document)
    .innerJoin(documentLink, eq(documentLink.fromDocument, document.id))
    .where(
      and(
        eq(document.kind, "amendment"),
        eq(document.status, "issued"),
        eq(documentLink.toDocument, contractDocumentId),
        eq(documentLink.relation, "amends"),
        // An avenant signed the same day as the situation counts: the two
        // pieces of paper travelled together and the situation quotes it.
        asOf ? lte(document.issuedOn, asOf) : undefined,
      ),
    )
    .orderBy(asc(document.issuedOn), asc(document.createdAt));
}

/**
 * WHICH document is the project's marché, without composing it.
 *
 * `contractOf` reads the bordereau and every avenant on it — six round trips —
 * and a caller that only wants to link a document to the marché needs one.
 * The preference is the same as `contractOf`'s, and so is the refusal to write
 * a guess back.
 */
export async function contractDocumentIdOf(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ contractDocumentId: project.contractDocumentId, dealId: project.dealId })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!row) return null;
  if (row.contractDocumentId) return row.contractDocumentId;

  const candidates = await contractCandidates(row.dealId);
  return (
    (
      candidates.find((c) => c.kind === "client_order") ??
      candidates.find((c) => c.kind === "quotation") ??
      candidates.find((c) => c.kind === "proforma")
    )?.documentId ?? null
  );
}

/**
 * The project's DQE contractuel.
 *
 * The one a person named when the project was opened; failing that, the
 * client's order, and failing that the offer they accepted — the same
 * preference the opening form shows first. The fallback is not written back:
 * a guess the system made is not a fact somebody confirmed.
 *
 * `asOf` reads the marché as it stood on that date — see `amendmentsOf`.
 */
export async function contractOf(
  projectId: string,
  asOf?: string | null,
): Promise<Contract | null> {
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

  const base = await contractLines(chosen.documentId);
  const found = await amendmentsOf(chosen.documentId, asOf);
  const { lines, perAmendment, deltas } = await amendedLines(
    base,
    found.map((a) => a.documentId),
  );

  // Each avenant's delta is what the bordereau was worth after it, less what
  // it was worth before — arithmetic on its own lines, not a figure anybody
  // types twice, and out of the one composition rather than one per avenant.
  const amendments: Amendment[] = found.map((one) => ({
    documentId: one.documentId,
    number: one.number,
    issuedOn: one.issuedOn,
    deltaExcl: deltas.get(one.documentId) ?? "0.00",
    changed: perAmendment.get(one.documentId)?.changed ?? 0,
    added: perAmendment.get(one.documentId)?.added ?? 0,
  }));

  return { ...chosen, lines, amendments };
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
  /** The marché as signed, plus what its avenants added. */
  contractExcl: string | null;
  contract: { documentId: string; number: string | null; kind: string };
  /** "s/marché + avenant n° 2" — what the wilaya's form prints. */
  amendments: Amendment[];
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
      issuedOn: document.issuedOn,
      status: document.status,
    })
    .from(situationDetail)
    .innerJoin(project, eq(project.id, situationDetail.projectId))
    .innerJoin(document, eq(document.id, situationDetail.documentId))
    .where(eq(situationDetail.documentId, documentId))
    .limit(1);
  if (!detail) return null;

  // The marché as it stood the day this situation was ISSUED. A draft is read
  // against the marché as it stands now — it has not been anywhere yet, and
  // it is the same marché the screen that writes it is showing.
  const contract = await contractOf(
    detail.projectId,
    detail.status === "issued" ? detail.issuedOn : null,
  );
  if (!contract) return null;

  const lines = await db
    .select({ sourceLineId: documentLine.sourceLineId, qty: documentLine.qty })
    .from(documentLine)
    .where(eq(documentLine.documentId, documentId));
  const period: Record<string, string> = {};
  for (const line of lines) if (line.sourceLineId) period[line.sourceLineId] = plain(line.qty);

  const before = await claimedBefore(detail.projectId, detail.sequence);
  const rows = situationRows({ contract: contract.lines, previous: before.byLine, period });

  // The marché the person typed, plus what each avenant added. Progress is
  // measured against what is under contract TODAY — a situation reading 104%
  // because an avenant is not counted is a figure that starts an argument.
  const contractExcl = withAmendments(detail.amountExcl, contract.amendments);

  return {
    documentId,
    projectId: detail.projectId,
    projectCode: detail.code,
    object: detail.object,
    contractRef: detail.contractRef,
    wilaya: detail.wilaya,
    contractExcl,
    contract: { documentId: contract.documentId, number: contract.number, kind: contract.kind },
    amendments: contract.amendments,
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
      contractExcl,
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

/** One line of the marché, as the avenant's screen shows it. */
export type AmendmentRow = {
  lineId: string;
  position: number;
  reference: string | null;
  designation: string | null;
  unit: string | null;
  /** What the marché says today. A placeholder on the screen, never a default. */
  qty: string;
  unitPrice: string;
  vatRate: string;
  /** What the open avenant makes of this line, when it touches it at all. */
  newQty: string | null;
  newUnitPrice: string | null;
};

/** A prix nouveau: a price the avenant introduces, on no line of the marché. */
export type AmendmentAddition = {
  reference: string | null;
  designation: string;
  unit: string | null;
  qty: string;
  unitPrice: string;
  vatRate: string;
};

export type NextAmendment = {
  projectId: string;
  contract: Contract | null;
  /** The avenant still open, which the screen edits instead of opening a second. */
  draft: {
    documentId: string;
    theirNumber: string | null;
    signedOn: string | null;
    /** What this avenant makes of the délai, when it touches it. */
    newContractualEnd: string | null;
    reason: string | null;
  } | null;
  rows: AmendmentRow[];
  additions: AmendmentAddition[];
  /** The marché as its issued avenants left it — what this one starts from. */
  contractExcl: string;
  /** The délai as they left it, which this one may move again. */
  deadline: string | null;
  blocked: "noContract" | null;
};

/**
 * Everything the avenant screen shows.
 *
 * The marché's bordereau as it stands — after every avenant already issued —
 * with, on each line, whatever the open avenant makes of it. An avenant is
 * read against the paper it changes; a blank column means "this one does not
 * touch this price", which is the common case and must cost nothing to say.
 */
export async function nextAmendment(projectId: string): Promise<NextAmendment | null> {
  const [exists] = await db
    .select({ id: project.id, contractualEnd: project.contractualEnd })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!exists) return null;

  const deadline = await deadlineOf(projectId, exists.contractualEnd);

  const contract = await contractOf(projectId);
  if (!contract) {
    return {
      projectId,
      contract: null,
      draft: null,
      rows: [],
      additions: [],
      contractExcl: "0",
      deadline,
      blocked: "noContract",
    };
  }

  // One open avenant at a time, for the reason there is one open situation:
  // two drafts amending the same bordereau cannot both be read against it.
  const [open] = await db
    .select({ id: document.id, number: document.number, issuedOn: document.issuedOn })
    .from(document)
    .innerJoin(documentLink, eq(documentLink.fromDocument, document.id))
    .where(
      and(
        eq(document.kind, "amendment"),
        eq(document.status, "draft"),
        eq(documentLink.toDocument, contract.documentId),
        eq(documentLink.relation, "amends"),
      ),
    )
    .limit(1);

  const drafted = open
    ? await db
        .select()
        .from(documentLine)
        .where(and(eq(documentLine.documentId, open.id), eq(documentLine.lineKind, "item")))
        .orderBy(asc(documentLine.position))
    : [];

  const [openDetail] = open
    ? await db
        .select()
        .from(amendmentDetail)
        .where(eq(amendmentDetail.documentId, open.id))
        .limit(1)
    : [];

  const rows: AmendmentRow[] = contract.lines.map((line) => {
    const touched = drafted.find((d) => d.sourceLineId === line.lineId);
    return {
      lineId: line.lineId,
      position: line.position,
      reference: line.reference,
      designation: line.designation,
      unit: line.unit,
      qty: line.qty,
      unitPrice: line.unitPrice,
      vatRate: line.vatRate,
      newQty: touched ? plain(touched.qty) : null,
      newUnitPrice: touched ? plain(touched.unitPrice) : null,
    };
  });

  const onContract = new Set(contract.lines.map((line) => line.lineId));
  const additions: AmendmentAddition[] = drafted
    .filter((d) => !d.sourceLineId || !onContract.has(d.sourceLineId))
    .map((d) => ({
      reference: d.reference,
      designation: d.designation ?? "",
      unit: d.unit,
      qty: plain(d.qty),
      unitPrice: plain(d.unitPrice),
      vatRate: d.vatRate ?? "0",
    }));

  return {
    projectId,
    contract,
    draft: open
      ? {
          documentId: open.id,
          theirNumber: open.number,
          signedOn: open.issuedOn,
          newContractualEnd: openDetail?.newContractualEnd ?? null,
          reason: openDetail?.reason ?? null,
        }
      : null,
    rows,
    additions,
    deadline,
    contractExcl: amountOf(contract.lines).toFixed(2),
    blocked: null,
  };
}

export type AmendmentInput = {
  projectId: string;
  /**
   * marché lineId → what the avenant makes of that line. A blank field keeps
   * the marché's own figure: an avenant that moves a quantity has not touched
   * the price, and re-stating the price would be us saying so, not them.
   */
  changes: Record<string, { qty?: string | null; unitPrice?: string | null }>;
  /** Prix nouveaux — lines the avenant introduces. Blank rows are dropped. */
  additions: {
    reference?: string | null;
    designation?: string | null;
    unit?: string | null;
    qty?: string | null;
    unitPrice?: string | null;
  }[];
  /** Theirs: "Avenant n° 2". Blank until the signed paper comes back. */
  theirNumber: string | null;
  /** The date on the signature. */
  signedOn: string | null;
  /**
   * The délai as this avenant leaves it. Blank when it does not touch it —
   * and an avenant de prolongation is nothing BUT this, which is why an
   * avenant carrying no line at all is still an avenant.
   */
  newContractualEnd: string | null;
  /** "Quantités supplémentaires, terrain rocheux" — why, in their words. */
  reason: string | null;
  actorId: string;
};

/** "" and null are "not said"; "0" is a figure somebody typed. */
function said(value: string | null | undefined): boolean {
  return (
    value !== null && value !== undefined && value.trim() !== "" && Number.isFinite(Number(value))
  );
}

/**
 * Write the avenant as a DRAFT, or rewrite the one still open.
 *
 * It carries only what the avenant states: the lines whose quantity or price
 * it moves, each pointing back at the line of the marché it replaces, and the
 * prix nouveaux it introduces, pointing at nothing. `contractOf` composes the
 * two, so every situation raised afterwards bills against the amended marché
 * without anybody retyping the bordereau.
 *
 * Nothing is amended until it is issued (LAW 2), and once issued it cannot
 * change (LAW 5): a second avenant is how the first is corrected, which is
 * what a wilaya does too.
 *
 * This has its own screen rather than the builder for the reason a situation
 * does — the builder saves lines as typed, with no memory of which line of the
 * marché each one answers, and an avenant that has forgotten that is a
 * bordereau of forty new prices.
 */
export async function saveAmendment(input: AmendmentInput): Promise<string> {
  const next = await nextAmendment(input.projectId);
  if (!next) throw new ProjectRefused("noSuchProject");
  if (next.blocked) throw new ProjectRefused(next.blocked);
  const contract = next.contract as Contract;

  const touched = Object.entries(input.changes).filter(
    ([, patch]) => said(patch.qty) || said(patch.unitPrice),
  );
  for (const [lineId] of touched) {
    if (!contract.lines.some((line) => line.lineId === lineId)) {
      throw new ProjectRefused("lineNotOnContract");
    }
  }

  // A row of the prix nouveaux block with nothing in it is not a mistake, it
  // is an empty row. A row with a designation and no price is.
  const additions = input.additions.filter(
    (a) => (a.designation ?? "").trim() !== "" || said(a.qty) || said(a.unitPrice),
  );
  for (const a of additions) {
    if ((a.designation ?? "").trim() === "") throw new ProjectRefused("additionNeedsDesignation");
    if (!said(a.qty) || Number(a.qty) <= 0 || !said(a.unitPrice) || Number(a.unitPrice) <= 0) {
      throw new ProjectRefused("additionNeedsPrice");
    }
  }

  // An avenant de prolongation de délai carries no price at all: a new date is
  // as much a change as a quantity, and refusing it would be the ERP saying
  // the paper in somebody's hand does not exist.
  const movesTheDeadline = Boolean(input.newContractualEnd?.trim());
  if (touched.length === 0 && additions.length === 0 && !movesTheDeadline) {
    throw new ProjectRefused("nothingAmended");
  }

  const [row] = await db
    .select({ partyId: project.partyId, dealId: project.dealId, currency: project.currency })
    .from(project)
    .where(eq(project.id, input.projectId))
    .limit(1);
  if (!row) throw new ProjectRefused("noSuchProject");

  const [client] = await db
    .select({ docLocale: party.docLocale })
    .from(party)
    .where(eq(party.id, row.partyId))
    .limit(1);

  // A prix nouveau on a marché de travaux carries the rate the marché carries;
  // the person can change it in the builder if this one ever differs.
  const defaultVat = contract.lines[0]?.vatRate ?? "19";

  const stated = [
    ...touched.map(([lineId, patch]) => {
      const line = contract.lines.find((l) => l.lineId === lineId) as ContractLine;
      return {
        sourceLineId: line.lineId,
        reference: line.reference,
        designation: line.designation,
        unit: line.unit,
        qty: said(patch.qty) ? new Decimal(patch.qty as string).toFixed() : line.qty,
        unitPrice: said(patch.unitPrice)
          ? new Decimal(patch.unitPrice as string).toFixed()
          : line.unitPrice,
        vatRate: line.vatRate,
      };
    }),
    ...additions.map((a) => ({
      sourceLineId: null,
      reference: a.reference?.trim() || null,
      designation: (a.designation as string).trim(),
      unit: a.unit?.trim() || null,
      qty: new Decimal(a.qty as string).toFixed(),
      unitPrice: new Decimal(a.unitPrice as string).toFixed(),
      vatRate: defaultVat,
    })),
  ];

  // The avenant's own money is the value of the prices it states. What it adds
  // to the marché — the incidence financière — is arithmetic against the
  // bordereau, computed where the marché is composed rather than typed here.
  // An avenant de prolongation states no price. `{}` rather than a computed
  // block of noughts, for the reason a bon de livraison stores `{}`: a total
  // of zero reads as a bill for nothing, and this paper is not a bill at all.
  const totals =
    stated.length === 0
      ? {}
      : computeTotals(
          stated.map((line) => ({
            qty: line.qty,
            unitPrice: line.unitPrice,
            vatRate: line.vatRate,
          })),
        );

  const lines = stated.map((line, index) => ({
    ...line,
    position: index + 1,
    lineKind: "item",
    totalExcl: lineTotalExcl({ qty: line.qty, unitPrice: line.unitPrice }).toFixed(2),
  }));

  return db.transaction(async (tx) => {
    let documentId: string;

    if (next.draft) {
      documentId = next.draft.documentId;
      await tx
        .update(document)
        .set({
          number: input.theirNumber?.trim() || null,
          issuedOn: input.signedOn ?? undefined,
          totals,
        })
        .where(eq(document.id, documentId));
      await tx.delete(documentLine).where(eq(documentLine.documentId, documentId));
    } else {
      const [created] = await tx
        .insert(document)
        .values({
          kind: "amendment",
          // LAW 5 allocates us no number here: the number on an avenant is the
          // client's, typed off the signed paper.
          number: input.theirNumber?.trim() || null,
          partyId: row.partyId,
          dealId: row.dealId,
          locale: client?.docLocale ?? "fr",
          currency: row.currency,
          issuedOn: input.signedOn ?? new Date().toISOString().slice(0, 10),
          status: "draft",
          settlement: "virement",
          totals,
        })
        .returning({ id: document.id });
      documentId = created?.id as string;

      await tx.insert(documentLink).values({
        fromDocument: documentId,
        toDocument: contract.documentId,
        relation: "amends",
      });
    }

    // An avenant de prolongation states no price, and inserting an empty list
    // is an error rather than a no-op.
    if (lines.length > 0) {
      await tx.insert(documentLine).values(lines.map((line) => ({ ...line, documentId })));
    }

    // The two things an avenant does that have no line: it moves the délai,
    // and it gives a reason.
    const detail = {
      documentId,
      projectId: input.projectId,
      newContractualEnd: input.newContractualEnd?.trim() || null,
      reason: input.reason?.trim() || null,
    };
    await tx
      .insert(amendmentDetail)
      .values(detail)
      .onConflictDoUpdate({
        target: amendmentDetail.documentId,
        set: { newContractualEnd: detail.newContractualEnd, reason: detail.reason },
      });

    await tx.insert(auditEntry).values({
      actorId: input.actorId,
      actorKind: "user",
      entity: "document",
      entityId: documentId,
      action: next.draft ? "edit" : "create",
      after: {
        kind: "amendment",
        projectId: input.projectId,
        amends: contract.documentId,
        changed: touched.length,
        added: additions.length,
        newContractualEnd: detail.newContractualEnd,
        alreadyAmendedBy: contract.amendments.length,
      },
      sourceScreen: "16",
    });

    return documentId;
  });
}

/**
 * What every project's avenants added, for many projects at once.
 *
 * The list and the detail page and the situation must all say the same number
 * — a project reading 4 390 000 in one place and 4 710 000 in another is a
 * question somebody has to ask the Gérant. So this exists rather than each
 * screen doing its own arithmetic.
 *
 * Cheap when nothing has been amended, which is the common case: one query
 * finds the amendments, and if there are none it stops there.
 *
 * And FOUR queries when there are — for one project or for thirty. It used to
 * call `contractOf` per project, which is six round trips each and one more
 * per avenant; screen 15 with thirty marchés was two hundred queries to draw a
 * list. The work is the same arithmetic, done here over rows read in bulk.
 */
export async function amendmentDeltas(projectIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (projectIds.length === 0) return out;

  // 1 — the projects that have an issued avenant at all, with their marché.
  const amended = await db
    .selectDistinct({ projectId: project.id, contractId: project.contractDocumentId })
    .from(project)
    .innerJoin(documentLink, eq(documentLink.toDocument, project.contractDocumentId))
    .innerJoin(document, eq(document.id, documentLink.fromDocument))
    .where(
      and(
        inArray(project.id, projectIds),
        eq(documentLink.relation, "amends"),
        eq(document.kind, "amendment"),
        eq(document.status, "issued"),
      ),
    );
  if (amended.length === 0) return out;

  const contractIds = [...new Set(amended.map((a) => a.contractId as string))];

  // 2 — every marché's bordereau, in one read.
  const baseRows = await db
    .select()
    .from(documentLine)
    .where(and(inArray(documentLine.documentId, contractIds), eq(documentLine.lineKind, "item")))
    .orderBy(asc(documentLine.position));

  // 3 — every avenant on those marchés, oldest first, in one read.
  const amendmentRows = await db
    .select({
      contractId: documentLink.toDocument,
      documentId: document.id,
      issuedOn: document.issuedOn,
      createdAt: document.createdAt,
    })
    .from(document)
    .innerJoin(documentLink, eq(documentLink.fromDocument, document.id))
    .where(
      and(
        eq(document.kind, "amendment"),
        eq(document.status, "issued"),
        inArray(documentLink.toDocument, contractIds),
        eq(documentLink.relation, "amends"),
      ),
    )
    .orderBy(asc(document.issuedOn), asc(document.createdAt));

  // 4 — every avenant's lines, in one read.
  const amendmentLineRows = amendmentRows.length
    ? await db
        .select()
        .from(documentLine)
        .where(
          and(
            inArray(
              documentLine.documentId,
              amendmentRows.map((a) => a.documentId),
            ),
            eq(documentLine.lineKind, "item"),
          ),
        )
        .orderBy(asc(documentLine.position))
    : [];

  // Then the same arithmetic `contractOf` does, per marché, in memory.
  const byContract = new Map<string, string>();
  for (const contractId of contractIds) {
    const base = baseRows
      .filter((line) => line.documentId === contractId && !line.isOption)
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
    const ids = amendmentRows.filter((a) => a.contractId === contractId).map((a) => a.documentId);
    const { deltas } = composeLines(base, ids, amendmentLineRows);
    const total = ids.reduce((sum, id) => sum.plus(deltas.get(id) ?? "0"), new Decimal(0));
    byContract.set(contractId, total.toFixed(2));
  }

  for (const row of amended) {
    const delta = byContract.get(row.contractId as string);
    if (delta && !new Decimal(delta).isZero()) out.set(row.projectId, delta);
  }
  return out;
}

export type AmendmentImpact = {
  projectId: string | null;
  contractDocumentId: string;
  /** The marché's own number — "MAR/2026/018". */
  contractNumber: string | null;
  /** Plain decimals; the engine formats them. */
  beforeExcl: string;
  incidenceExcl: string;
  afterExcl: string;
  changed: number;
  added: number;
  /** The délai as this avenant leaves it, and why. Null when it says nothing. */
  newContractualEnd: string | null;
  reason: string | null;
};

/**
 * What one avenant does to the marché it amends.
 *
 * An avenant states only the prices it moves, so its own total is the value of
 * those prices and not the marché's. The three figures a reader actually wants
 * — before, incidence, after — are arithmetic over the bordereau, and they are
 * computed HERE rather than typed, because a marché reading 4 390 000 on the
 * avenant and 4 710 000 on the project is a question somebody has to answer.
 *
 * Read against the avenants issued BEFORE this one: avenant n° 2's incidence is
 * measured on the marché as avenant n° 1 left it, which is what its own paper
 * says. A draft is measured against everything issued so far.
 */
export async function amendmentImpact(documentId: string): Promise<AmendmentImpact | null> {
  const [me] = await db
    .select({ kind: document.kind, dealId: document.dealId })
    .from(document)
    .where(eq(document.id, documentId))
    .limit(1);
  if (!me || me.kind !== "amendment") return null;

  const [link] = await db
    .select({ contractDocumentId: documentLink.toDocument })
    .from(documentLink)
    .where(and(eq(documentLink.fromDocument, documentId), eq(documentLink.relation, "amends")))
    .limit(1);
  if (!link) return null;

  const [marche] = await db
    .select({ number: document.number })
    .from(document)
    .where(eq(document.id, link.contractDocumentId))
    .limit(1);

  const base = await contractLines(link.contractDocumentId);
  const issued = await amendmentsOf(link.contractDocumentId);
  // A draft is not in that list, and `findIndex` says -1: everything issued
  // comes before it, which is exactly right.
  const at = issued.findIndex((a) => a.documentId === documentId);
  const prior = (at >= 0 ? issued.slice(0, at) : issued).map((a) => a.documentId);

  const before = await amendedLines(base, prior);
  const after = await amendedLines(base, [...prior, documentId]);
  const beforeExcl = amountOf(before.lines);
  const afterExcl = amountOf(after.lines);
  const tally = after.perAmendment.get(documentId) ?? { changed: 0, added: 0 };

  const [detail] = await db
    .select()
    .from(amendmentDetail)
    .where(eq(amendmentDetail.documentId, documentId))
    .limit(1);

  const [owner] = detail
    ? [{ id: detail.projectId }]
    : me.dealId
      ? await db
          .select({ id: project.id })
          .from(project)
          .where(eq(project.dealId, me.dealId))
          .limit(1)
      : [];

  return {
    newContractualEnd: detail?.newContractualEnd ?? null,
    reason: detail?.reason ?? null,
    projectId: owner?.id ?? null,
    contractDocumentId: link.contractDocumentId,
    contractNumber: marche?.number ?? null,
    beforeExcl: beforeExcl.toFixed(2),
    incidenceExcl: afterExcl.minus(beforeExcl).toFixed(2),
    afterExcl: afterExcl.toFixed(2),
    changed: tally.changed,
    added: tally.added,
  };
}

/**
 * The délai as the issued avenants left it.
 *
 * `project.contractual_end` is what the signed marché said and never changes,
 * for the reason an issued document never changes. An avenant de prolongation
 * moves the date, and the LAST one issued is the one in force — a wilaya that
 * extends twice extends from wherever the second avenant says, not from the
 * first.
 *
 * `asOf` reads the délai as it stood on that date, the way `contractOf` reads
 * the bordereau: a penalty computed today against a marché received in August
 * is counted against the deadline that was in force in August.
 */
export async function deadlineOf(
  projectId: string,
  contractualEnd: string | null,
  asOf?: string | null,
): Promise<string | null> {
  const rows = await db
    .select({ newEnd: amendmentDetail.newContractualEnd })
    .from(amendmentDetail)
    .innerJoin(document, eq(document.id, amendmentDetail.documentId))
    .where(
      and(
        eq(amendmentDetail.projectId, projectId),
        eq(document.status, "issued"),
        isNotNull(amendmentDetail.newContractualEnd),
        asOf ? lte(document.issuedOn, asOf) : undefined,
      ),
    )
    .orderBy(asc(document.issuedOn), asc(document.createdAt));

  return rows.at(-1)?.newEnd ?? contractualEnd;
}

/**
 * The VAT the marché's own bordereau carries, as a multiplier on its HT.
 *
 * "1.19" on a marché entirely at 19 %, and something between on one that
 * mixes rates. It exists because a CCAP that takes the pénalités on "le
 * montant du marché" TTC needs a TTC, and the project carries only the HT the
 * person typed — so the TTC is that figure with the bordereau's own VAT on it,
 * rather than a rate this system chose.
 *
 * "1" when the bordereau is empty or carries no VAT: no rate is invented.
 */
export async function contractVatRatio(projectId: string): Promise<string> {
  const contract = await contractOf(projectId);
  if (!contract || contract.lines.length === 0) return "1";
  const totals = computeTotals(
    contract.lines.map((line) => ({
      qty: line.qty,
      unitPrice: line.unitPrice,
      vatRate: line.vatRate,
    })),
  );
  const excl = new Decimal(totals.totalExcl);
  if (excl.lessThanOrEqualTo(0)) return "1";
  return new Decimal(totals.totalIncl).div(excl).toDecimalPlaces(6).toFixed();
}
