import Decimal from "decimal.js";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema/auth";
import { auditEntry } from "@/db/schema/control";
import { deal } from "@/db/schema/deal";
import { document } from "@/db/schema/document";
import { paymentAllocation } from "@/db/schema/money";
import { party, person, personCertification } from "@/db/schema/party";
import { project, projectCaution, projectCrew, situationDetail } from "@/db/schema/project";
import { RETENTION_BASES, type RetentionBase } from "@/domain/money";
import {
  type Caution,
  type CautionInput,
  type Crew,
  type CrewInput,
  needsAttention,
  readCautions,
  readCrew,
} from "./cautions";
import { asPenaltyBase, type PenaltyBase, type PenaltyView, penaltyOf } from "./penalty";
import {
  type PhysicalEstimate,
  type Progress,
  type ProjectState,
  physicalEstimate,
  progressOf,
  projectState,
  retentionRelease,
  type SituationInput,
} from "./progress";
import { retentionReturned } from "./retention";
import { amendmentDeltas, contractVatRatio, deadlineOf } from "./situations";

/**
 * Screens 15 and 16, against the database.
 *
 * A situation is a `document` of kind `situation` — the catalogue has held that
 * kind since phase 3 — with a `situation_detail` row for the period, the work
 * done and the date the client's engineer signed. Nothing about progress is
 * stored: financial progress is the approved situations over the contract, and
 * it moves the moment a signature is recorded.
 */

export class ProjectRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ProjectRefused";
  }
}

/** The marché as signed, plus what its avenants added. Null stays null. */
function underContract(amountExcl: string | null, delta: string | undefined): string | null {
  if (!amountExcl) return null;
  if (!delta) return amountExcl;
  return new Decimal(amountExcl).plus(delta).toFixed(2);
}

function asRetentionBase(value: string | null | undefined): RetentionBase | null {
  return (RETENTION_BASES as readonly string[]).includes(value ?? "")
    ? (value as RetentionBase)
    : null;
}

/** The project opened on an enquiry, if one was. An enquiry has at most one. */
export async function projectForDeal(dealId: string): Promise<{ id: string; code: string } | null> {
  const [row] = await db
    .select({ id: project.id, code: project.code })
    .from(project)
    .where(and(eq(project.dealId, dealId), isNull(project.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** PRJ-2026-004, allocated in the transaction that uses it. */
export async function nextProjectCode(tx: typeof db, when: Date): Promise<string> {
  const year = when.getUTCFullYear();
  const [row] = await tx
    .select({ n: sql<number>`coalesce(max(substring(${project.code} from 10)::int), 0)::int` })
    .from(project)
    .where(sql`${project.code} like ${`PRJ-${year}-%`}`);
  return `PRJ-${year}-${String((row?.n ?? 0) + 1).padStart(3, "0")}`;
}

export async function createProject(opts: {
  dealId: string;
  object: string;
  contractRef?: string | null;
  wilaya?: string | null;
  amountExcl?: string | null;
  startedOn?: string | null;
  contractualEnd?: string | null;
  retentionPct?: string;
  retentionBase?: string | null;
  warrantyMonths?: number | null;
  /** The issued order or offer whose lines are the DQE contractuel. */
  contractDocumentId?: string | null;
  actorId: string;
}): Promise<string> {
  const [found] = await db.select().from(deal).where(eq(deal.id, opts.dealId)).limit(1);
  if (!found) throw new ProjectRefused("noSuchDeal");
  if (!opts.object.trim()) throw new ProjectRefused("objectRequired");
  const retentionBase = asRetentionBase(opts.retentionBase);
  if (opts.retentionBase && !retentionBase) throw new ProjectRefused("badRetentionBase");
  if (opts.contractDocumentId) {
    const [contract] = await db
      .select({ status: document.status, dealId: document.dealId })
      .from(document)
      .where(eq(document.id, opts.contractDocumentId))
      .limit(1);
    if (contract?.status !== "issued") throw new ProjectRefused("contractNotIssued");
  }

  return db.transaction(async (tx) => {
    // Same cast `createDeal` uses: a Drizzle transaction has the same query
    // surface as the database handle and a different nominal type.
    const code = await nextProjectCode(tx as unknown as typeof db, new Date());
    const [row] = await tx
      .insert(project)
      .values({
        code,
        dealId: opts.dealId,
        partyId: found.partyId,
        object: opts.object.trim(),
        contractRef: opts.contractRef ?? null,
        wilaya: opts.wilaya ?? null,
        amountExcl: opts.amountExcl ?? null,
        currency: found.currency,
        startedOn: opts.startedOn ?? null,
        contractualEnd: opts.contractualEnd ?? null,
        retentionPct: opts.retentionPct ?? "0",
        retentionBase,
        warrantyMonths: opts.warrantyMonths ?? null,
        contractDocumentId: opts.contractDocumentId ?? null,
        createdBy: opts.actorId,
      })
      .returning({ id: project.id });

    await tx.insert(auditEntry).values({
      entity: "project",
      entityId: row?.id as string,
      action: "create",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "15",
      after: { code, dealId: opts.dealId },
    });

    return row?.id as string;
  });
}

/** Situations for many projects in one query. */
async function situationsFor(projectIds: string[]): Promise<Map<string, SituationInput[]>> {
  const out = new Map<string, SituationInput[]>();
  for (const id of projectIds) out.set(id, []);
  if (projectIds.length === 0) return out;

  const rows = await db
    .select({
      projectId: situationDetail.projectId,
      documentId: document.id,
      sequence: situationDetail.sequence,
      number: document.number,
      amountExcl: sql<string>`coalesce(${document.totals}->>'totalExcl', '0')`,
      submittedOn: situationDetail.submittedOn,
      approvedOn: situationDetail.approvedOn,
      paid: sql<string>`(
        select coalesce(sum(${paymentAllocation.amount}), 0)::text
        from ${paymentAllocation}
        where ${paymentAllocation.documentId} = ${document.id}
      )`,
    })
    .from(situationDetail)
    .innerJoin(document, eq(document.id, situationDetail.documentId))
    .where(inArray(situationDetail.projectId, projectIds))
    .orderBy(asc(situationDetail.sequence));

  for (const row of rows) {
    out.get(row.projectId)?.push({
      documentId: row.documentId,
      sequence: row.sequence,
      number: row.number,
      amountExcl: row.amountExcl,
      submittedOn: row.submittedOn,
      approvedOn: row.approvedOn,
      paid: row.paid,
    });
  }
  return out;
}

export type ProjectRow = {
  id: string;
  code: string;
  client: string;
  object: string;
  wilaya: string | null;
  currency: string;
  progress: Progress;
  state: ProjectState;
  situationsApproved: number;
  situationsTotal: number;
  /** Cautions that want somebody's attention today. */
  cautionsNeedingAttention: number;
};

export async function listProjects(now = new Date()): Promise<ProjectRow[]> {
  const rows = await db
    .select({
      id: project.id,
      code: project.code,
      object: project.object,
      wilaya: project.wilaya,
      currency: project.currency,
      amountExcl: project.amountExcl,
      retentionPct: project.retentionPct,
      physicalPercent: project.physicalPercent,
      pvProvisoireOn: project.pvProvisoireOn,
      pvProvisoirePlanned: project.pvProvisoirePlanned,
      closedAt: project.closedAt,
      client: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
    })
    .from(project)
    .leftJoin(party, eq(party.id, project.partyId))
    .where(isNull(project.deletedAt))
    .orderBy(asc(project.code));

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [situations, cautions, deltas, released] = await Promise.all([
    situationsFor(ids),
    db.select().from(projectCaution).where(inArray(projectCaution.projectId, ids)),
    // What the avenants added. Progress is measured against what is under
    // contract today, and the list must say the same number the project page
    // and the situation say.
    amendmentDeltas(ids),
    // And what the client has given back of the retention, which is the only
    // thing that ends a warranty.
    retentionReturned(ids),
  ]);

  return rows.map((row) => {
    const progress = progressOf({
      situations: situations.get(row.id) ?? [],
      contract: underContract(row.amountExcl, deltas.get(row.id)),
      retentionPct: row.retentionPct,
      retentionReleased: released.get(row.id),
      physicalPercent: row.physicalPercent,
      now,
    });

    const mine = cautions.filter((c) => c.projectId === row.id);
    const read = readCautions({
      cautions: mine.map(toCautionInput),
      now,
      acceptanceOn: row.pvProvisoireOn ?? row.pvProvisoirePlanned,
    });

    return {
      id: row.id,
      code: row.code,
      client: row.client ?? "—",
      object: row.object,
      wilaya: row.wilaya,
      currency: row.currency,
      progress,
      state: projectState({
        closedAt: row.closedAt,
        pvProvisoireOn: row.pvProvisoireOn,
        // What the client is STILL holding. See `projectState`.
        retentionHeld: progress.money.retentionOutstanding,
      }),
      situationsApproved: progress.situations.filter(
        (s) => s.state === "approved" || s.state === "paid",
      ).length,
      situationsTotal: progress.situations.length,
      cautionsNeedingAttention: read.filter((c) => needsAttention(c.state)).length,
    };
  });
}

function toCautionInput(row: typeof projectCaution.$inferSelect): CautionInput {
  return {
    id: row.id,
    kind: row.kind,
    amount: row.amount,
    pct: row.pct,
    bankName: row.bankName,
    reference: row.reference,
    expiresOn: row.expiresOn,
    releasedOn: row.releasedOn,
  };
}

export type ProjectDetail = ProjectRow & {
  dealId: string;
  dealRef: string;
  contractRef: string | null;
  amountExcl: string | null;
  startedOn: string | null;
  /** The délai the marché was signed with. Never moves — see `deadline`. */
  contractualEnd: string | null;
  /** The délai as the issued avenants left it: what everything is judged by. */
  deadline: string | null;
  /** Days from today to the délai in force. Negative means late. */
  daysLeft: number | null;
  retentionPct: string;
  retentionBase: RetentionBase | null;
  penaltyPerMille: string | null;
  penaltyCapPct: string | null;
  penaltyBase: PenaltyBase | null;
  /**
   * What the CCAP's clause comes to — a figure the CLIENT may apply, never one
   * this system withholds. Blocked until somebody has read the clause.
   */
  penalty: PenaltyView;
  /** The clause in the client's own words, from the enquiry. The authority. */
  latePenaltyText: string | null;
  contractDocumentId: string | null;
  warrantyMonths: number | null;
  pvProvisoireOn: string | null;
  pvProvisoirePlanned: string | null;
  pvDefinitiveOn: string | null;
  retentionReleases: ReturnType<typeof retentionRelease>;
  /**
   * The physical estimate with the name and the date on it. Null until
   * somebody has made one — and never a nought, because nobody saying is not
   * the same fact as nobody having done anything.
   */
  physical: PhysicalEstimate | null;
  cautions: Caution[];
  crew: Crew[];
};

export async function getProject(id: string, now = new Date()): Promise<ProjectDetail | null> {
  const [row] = await db
    .select({
      id: project.id,
      code: project.code,
      object: project.object,
      wilaya: project.wilaya,
      currency: project.currency,
      amountExcl: project.amountExcl,
      contractRef: project.contractRef,
      retentionPct: project.retentionPct,
      retentionBase: project.retentionBase,
      penaltyPerMille: project.penaltyPerMille,
      penaltyCapPct: project.penaltyCapPct,
      penaltyBase: project.penaltyBase,
      contractDocumentId: project.contractDocumentId,
      warrantyMonths: project.warrantyMonths,
      physicalPercent: project.physicalPercent,
      // Who said so and when. LEFT, like the audit trail's join: an estimate
      // made by somebody who has since left the company is still what was
      // said on the day, and dropping the row would hide the estimate itself.
      physicalBy: user.name,
      physicalAt: project.physicalAt,
      startedOn: project.startedOn,
      contractualEnd: project.contractualEnd,
      pvProvisoireOn: project.pvProvisoireOn,
      pvProvisoirePlanned: project.pvProvisoirePlanned,
      pvDefinitiveOn: project.pvDefinitiveOn,
      closedAt: project.closedAt,
      dealId: project.dealId,
      dealRef: deal.ref,
      latePenalty: deal.latePenalty,
      client: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
    })
    .from(project)
    .leftJoin(party, eq(party.id, project.partyId))
    .leftJoin(deal, eq(deal.id, project.dealId))
    .leftJoin(user, eq(user.id, project.physicalBy))
    .where(eq(project.id, id))
    .limit(1);

  if (!row) return null;

  const situations = await situationsFor([id]);
  const deltas = await amendmentDeltas([id]);
  // Under contract today — the marché as signed, plus its avenants. One
  // figure, read by the progress, the penalty and the page.
  const contractExcl = underContract(row.amountExcl, deltas.get(id));
  const progress = progressOf({
    situations: situations.get(id) ?? [],
    contract: contractExcl,
    retentionPct: row.retentionPct,
    retentionReleased: (await retentionReturned([id])).get(id),
    physicalPercent: row.physicalPercent,
    now,
  });

  const acceptanceOn = row.pvProvisoireOn ?? row.pvProvisoirePlanned;

  const cautionRows = await db
    .select()
    .from(projectCaution)
    .where(eq(projectCaution.projectId, id))
    .orderBy(asc(projectCaution.expiresOn));

  const cautions = readCautions({
    cautions: cautionRows.map(toCautionInput),
    now,
    acceptanceOn,
  });

  const crew = readCrew({ crew: await crewFor(id), now });

  // The délai in force — the marché's, as its avenants left it. Everything
  // that judges lateness reads this and not the signed date.
  const deadline = await deadlineOf(id, row.contractualEnd);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const daysLeft = deadline
    ? Math.round((new Date(`${deadline}T00:00:00Z`).getTime() - today.getTime()) / 86_400_000)
    : null;

  const penalty = penaltyOf({
    perMille: row.penaltyPerMille,
    capPct: row.penaltyCapPct,
    base: asPenaltyBase(row.penaltyBase),
    contractExcl,
    // The marché's HT with the bordereau's own VAT on it — never a rate this
    // system chose. See `contractVatRatio`.
    contractIncl:
      row.penaltyBase === "incl" && contractExcl
        ? new Decimal(contractExcl).times(await contractVatRatio(id)).toFixed(2)
        : null,
    deadline,
    receivedOn: row.pvProvisoireOn,
    on: today.toISOString().slice(0, 10),
  });

  return {
    id: row.id,
    code: row.code,
    client: row.client ?? "—",
    object: row.object,
    wilaya: row.wilaya,
    currency: row.currency,
    progress,
    state: projectState({
      closedAt: row.closedAt,
      pvProvisoireOn: row.pvProvisoireOn,
      // What the client is STILL holding. See `projectState`.
      retentionHeld: progress.money.retentionOutstanding,
    }),
    situationsApproved: progress.situations.filter(
      (s) => s.state === "approved" || s.state === "paid",
    ).length,
    situationsTotal: progress.situations.length,
    cautionsNeedingAttention: cautions.filter((c) => needsAttention(c.state)).length,
    dealId: row.dealId,
    dealRef: row.dealRef ?? "—",
    contractRef: row.contractRef,
    amountExcl: row.amountExcl,
    startedOn: row.startedOn,
    contractualEnd: row.contractualEnd,
    deadline,
    daysLeft,
    retentionPct: row.retentionPct,
    retentionBase: asRetentionBase(row.retentionBase),
    penaltyPerMille: row.penaltyPerMille,
    penaltyCapPct: row.penaltyCapPct,
    penaltyBase: asPenaltyBase(row.penaltyBase),
    penalty,
    latePenaltyText: row.latePenalty,
    contractDocumentId: row.contractDocumentId,
    warrantyMonths: row.warrantyMonths,
    pvProvisoireOn: row.pvProvisoireOn,
    pvProvisoirePlanned: row.pvProvisoirePlanned,
    pvDefinitiveOn: row.pvDefinitiveOn,
    retentionReleases: retentionRelease({
      pvProvisoireOn: row.pvProvisoireOn,
      pvDefinitiveOn: row.pvDefinitiveOn,
      warrantyMonths: row.warrantyMonths,
    }),
    physical: physicalEstimate({
      percent: row.physicalPercent,
      by: row.physicalBy,
      at: row.physicalAt,
      now,
    }),
    cautions,
    crew,
  };
}

/**
 * Who is on site, with the SOONEST-expiring certification each of them holds.
 *
 * Soonest, not most recent: the question the screen asks is whether this man
 * may work tomorrow, and the answer is decided by whichever of his tickets runs
 * out first.
 */
async function crewFor(projectId: string): Promise<CrewInput[]> {
  const rows = await db
    .select({
      id: projectCrew.id,
      personId: projectCrew.personId,
      name: person.fullName,
      trade: person.trade,
      role: projectCrew.role,
      onSiteSince: projectCrew.onSiteSince,
      leftOn: projectCrew.leftOn,
      proposedAt: projectCrew.proposedAt,
      certification: sql<string | null>`(
        select ${personCertification.kind} from ${personCertification}
        where ${personCertification.personId} = ${projectCrew.personId}
        order by ${personCertification.expiresOn} asc nulls last limit 1
      )`,
      certificationExpiresOn: sql<string | null>`(
        select ${personCertification.expiresOn} from ${personCertification}
        where ${personCertification.personId} = ${projectCrew.personId}
        order by ${personCertification.expiresOn} asc nulls last limit 1
      )`,
    })
    .from(projectCrew)
    .innerJoin(person, eq(person.id, projectCrew.personId))
    .where(eq(projectCrew.projectId, projectId))
    .orderBy(asc(person.fullName));

  return rows;
}

/** The estimate a person made, with their name on it. */
export async function setPhysicalProgress(opts: {
  projectId: string;
  percent: number;
  actorId: string;
}): Promise<void> {
  if (opts.percent < 0 || opts.percent > 100) throw new ProjectRefused("percentOutOfRange");

  await db.transaction(async (tx) => {
    await tx
      .update(project)
      .set({ physicalPercent: opts.percent, physicalBy: opts.actorId, physicalAt: new Date() })
      .where(eq(project.id, opts.projectId));

    await tx.insert(auditEntry).values({
      entity: "project",
      entityId: opts.projectId,
      action: "update",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "16",
      after: { physicalPercent: opts.percent },
    });
  });
}

/** Every project holding a guarantee that wants attention today. */
export async function projectsNeedingAttention(now = new Date()): Promise<ProjectRow[]> {
  const rows = await listProjects(now);
  return rows.filter(
    (row) =>
      row.cautionsNeedingAttention > 0 ||
      (row.progress.longestWait?.waitingDays ?? 0) >= 14 ||
      (row.progress.aheadOfBilling ?? 0) >= 20,
  );
}

export async function projectCounts(now = new Date()) {
  const rows = await listProjects(now);
  return {
    all: rows.length,
    active: rows.filter((r) => r.state === "active").length,
    warranty: rows.filter((r) => r.state === "warranty").length,
    closed: rows.filter((r) => r.state === "closed").length,
    retentionHeld: rows
      .reduce((total, row) => total + Number(row.progress.money.retentionHeld), 0)
      .toFixed(2),
    waiting: rows.filter((r) => r.progress.longestWait !== null).length,
    cautionsLive: rows.reduce((total, row) => total + row.cautionsNeedingAttention, 0),
  };
}

/** Attach somebody to a site. */
export async function addCrew(opts: {
  projectId: string;
  personId: string;
  role?: string | null;
  onSiteSince?: string | null;
  actorId: string;
}): Promise<void> {
  const [already] = await db
    .select({ id: projectCrew.id })
    .from(projectCrew)
    .where(
      and(
        eq(projectCrew.projectId, opts.projectId),
        eq(projectCrew.personId, opts.personId),
        isNull(projectCrew.leftOn),
      ),
    )
    .limit(1);
  if (already) throw new ProjectRefused("alreadyOnSite");

  await db.insert(projectCrew).values({
    projectId: opts.projectId,
    personId: opts.personId,
    role: opts.role ?? null,
    onSiteSince: opts.onSiteSince ?? null,
    proposedAt: opts.onSiteSince ? null : new Date(),
    createdBy: opts.actorId,
  });
}

/** Record a bank guarantee, or that the client gave one back. */
export async function saveCaution(opts: {
  projectId: string;
  kind: string;
  amount?: string | null;
  pct?: string | null;
  bankName?: string | null;
  reference?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  actorId: string;
}): Promise<string> {
  const [row] = await db
    .insert(projectCaution)
    .values({
      projectId: opts.projectId,
      kind: opts.kind,
      amount: opts.amount ?? null,
      pct: opts.pct ?? null,
      bankName: opts.bankName ?? null,
      reference: opts.reference ?? null,
      issuedOn: opts.issuedOn ?? null,
      expiresOn: opts.expiresOn ?? null,
      createdBy: opts.actorId,
    })
    .returning({ id: projectCaution.id });
  return row?.id as string;
}

export async function releaseCaution(opts: {
  cautionId: string;
  on: string;
  actorId: string;
}): Promise<void> {
  await db
    .update(projectCaution)
    .set({ releasedOn: opts.on })
    .where(eq(projectCaution.id, opts.cautionId));
}

/**
 * The contract's terms, as a person read them off the marché.
 *
 * Every field is optional and only the ones given are written, so the form
 * that fixes the retention base does not have to know the contractual end.
 * `retentionPct` and `retentionBase` change how the NEXT situation is
 * computed and nothing about the issued ones (LAW 5).
 */
export async function updateProjectTerms(opts: {
  projectId: string;
  contractRef?: string | null;
  wilaya?: string | null;
  amountExcl?: string | null;
  startedOn?: string | null;
  contractualEnd?: string | null;
  retentionPct?: string;
  retentionBase?: string | null;
  penaltyPerMille?: string | null;
  penaltyCapPct?: string | null;
  penaltyBase?: string | null;
  warrantyMonths?: number | null;
  contractDocumentId?: string | null;
  actorId: string;
}): Promise<void> {
  const patch: Partial<typeof project.$inferInsert> = {};
  if (opts.contractRef !== undefined) patch.contractRef = opts.contractRef;
  if (opts.wilaya !== undefined) patch.wilaya = opts.wilaya;
  if (opts.amountExcl !== undefined) patch.amountExcl = opts.amountExcl;
  if (opts.startedOn !== undefined) patch.startedOn = opts.startedOn;
  if (opts.contractualEnd !== undefined) patch.contractualEnd = opts.contractualEnd;
  if (opts.retentionPct !== undefined) patch.retentionPct = opts.retentionPct;
  if (opts.warrantyMonths !== undefined) patch.warrantyMonths = opts.warrantyMonths;
  if (opts.retentionBase !== undefined) {
    const base = asRetentionBase(opts.retentionBase);
    if (opts.retentionBase && !base) throw new ProjectRefused("badRetentionBase");
    patch.retentionBase = base;
  }
  if (opts.penaltyPerMille !== undefined) patch.penaltyPerMille = opts.penaltyPerMille;
  if (opts.penaltyCapPct !== undefined) patch.penaltyCapPct = opts.penaltyCapPct;
  if (opts.penaltyBase !== undefined) {
    const base = asPenaltyBase(opts.penaltyBase);
    if (opts.penaltyBase && !base) throw new ProjectRefused("badPenaltyBase");
    patch.penaltyBase = base;
  }
  if (opts.contractDocumentId !== undefined) {
    if (opts.contractDocumentId) {
      const [contract] = await db
        .select({ status: document.status })
        .from(document)
        .where(eq(document.id, opts.contractDocumentId))
        .limit(1);
      if (contract?.status !== "issued") throw new ProjectRefused("contractNotIssued");
    }
    patch.contractDocumentId = opts.contractDocumentId;
  }
  if (Object.keys(patch).length === 0) return;

  await db.transaction(async (tx) => {
    await tx.update(project).set(patch).where(eq(project.id, opts.projectId));
    await tx.insert(auditEntry).values({
      entity: "project",
      entityId: opts.projectId,
      action: "update",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "16",
      after: patch,
    });
  });
}

/**
 * The réceptions — three dates about two signed papers.
 *
 * `pvProvisoirePlanned` is a forecast and may be moved; the two `On` dates are
 * facts and are written once. The definitive one is refused before the
 * provisional exists, because a project cannot be finally accepted before it
 * is provisionally accepted, and the retention's release date hangs on that
 * order.
 */
export async function recordReception(opts: {
  projectId: string;
  pvProvisoirePlanned?: string | null;
  pvProvisoireOn?: string | null;
  pvDefinitiveOn?: string | null;
  actorId: string;
}): Promise<void> {
  const [row] = await db
    .select({ provisoire: project.pvProvisoireOn, definitive: project.pvDefinitiveOn })
    .from(project)
    .where(eq(project.id, opts.projectId))
    .limit(1);
  if (!row) throw new ProjectRefused("noSuchProject");

  const patch: Partial<typeof project.$inferInsert> = {};
  if (opts.pvProvisoirePlanned !== undefined) patch.pvProvisoirePlanned = opts.pvProvisoirePlanned;
  if (opts.pvProvisoireOn) {
    if (row.provisoire) throw new ProjectRefused("alreadyReceived");
    patch.pvProvisoireOn = opts.pvProvisoireOn;
  }
  if (opts.pvDefinitiveOn) {
    if (row.definitive) throw new ProjectRefused("alreadyReceived");
    const provisoire = patch.pvProvisoireOn ?? row.provisoire;
    if (!provisoire) throw new ProjectRefused("provisoireFirst");
    if (opts.pvDefinitiveOn < provisoire) throw new ProjectRefused("definitiveBeforeProvisoire");
    patch.pvDefinitiveOn = opts.pvDefinitiveOn;
  }
  if (Object.keys(patch).length === 0) return;

  await db.transaction(async (tx) => {
    await tx.update(project).set(patch).where(eq(project.id, opts.projectId));
    await tx.insert(auditEntry).values({
      entity: "project",
      entityId: opts.projectId,
      action: "update",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "16",
      after: patch,
    });
  });
}

/**
 * Somebody left the site, or a proposed man actually arrived. Two facts about
 * the same row; a proposed welder is not a welder, and a man who left in
 * August is not on the crew in September however long his ticket runs.
 */
export async function updateCrew(opts: {
  crewId: string;
  onSiteSince?: string | null;
  leftOn?: string | null;
  actorId: string;
}): Promise<void> {
  const [row] = await db.select().from(projectCrew).where(eq(projectCrew.id, opts.crewId)).limit(1);
  if (!row) throw new ProjectRefused("noSuchCrew");
  const patch: Partial<typeof projectCrew.$inferInsert> = {};
  if (opts.onSiteSince) {
    if (row.onSiteSince) throw new ProjectRefused("alreadyOnSite");
    patch.onSiteSince = opts.onSiteSince;
  }
  if (opts.leftOn) {
    if (row.leftOn) throw new ProjectRefused("alreadyLeft");
    const since = patch.onSiteSince ?? row.onSiteSince;
    if (since && opts.leftOn < since) throw new ProjectRefused("leftBeforeArrival");
    patch.leftOn = opts.leftOn;
  }
  if (Object.keys(patch).length === 0) return;

  await db.transaction(async (tx) => {
    await tx.update(projectCrew).set(patch).where(eq(projectCrew.id, opts.crewId));
    await tx.insert(auditEntry).values({
      entity: "project",
      entityId: row.projectId,
      action: "update",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "16",
      after: { crew: opts.crewId, ...patch },
    });
  });
}
