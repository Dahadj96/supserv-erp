import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { user } from "@/db/schema/auth";
import { auditEntry } from "@/db/schema/control";
import { party, person, personCertification } from "@/db/schema/party";
import { project } from "@/db/schema/project";
import { personnelCandidate, personnelRequest } from "@/db/schema/recruitment";
import { assertTransition } from "../control/transitions";
import {
  type CandidateStage,
  type PersonStage,
  type Request,
  readRequest,
  readShortlist,
  type ShortlistEntry,
  type ShortlistRow,
} from "./request";

/**
 * Screens 24, 25 and 26, against the database.
 *
 * The join everything rests on: a person's SOONEST-expiring certification.
 * Whether a man may work on the 24th is decided by whichever of his tickets
 * runs out first, and taking the latest one would say he is fine.
 */

export class RecruitmentRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "RecruitmentRefused";
  }
}

const CANDIDATE = "candidate";

/** The soonest-expiring certification, as a correlated sub-select. */
const soonestCertification = {
  certification: sql<string | null>`(
    select ${personCertification.kind} from ${personCertification}
    where ${personCertification.personId} = ${person.id}
    order by ${personCertification.expiresOn} asc nulls last limit 1
  )`,
  certificationExpiresOn: sql<string | null>`(
    select ${personCertification.expiresOn} from ${personCertification}
    where ${personCertification.personId} = ${person.id}
    order by ${personCertification.expiresOn} asc nulls last limit 1
  )`,
};

export type CandidateRow = {
  id: string;
  name: string;
  trade: string;
  appliedFor: string | null;
  mobility: string | null;
  wilaya: string | null;
  source: string;
  stage: PersonStage;
  certification: string | null;
  certificationExpiresOn: string | null;
  daysLeft: number | null;
  receivedAt: Date;
  /** Employed here now, whatever their pipeline stage says. */
  hired: boolean;
};

const DAY = 86_400_000;

function daysUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const at = new Date(`${iso}T00:00:00Z`).getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((at - today) / DAY);
}

/**
 * Screen 24 — the candidates.
 *
 * Everybody whose `relationship` is `candidate`, plus everybody who was one and
 * has since been hired: the pipeline's whole point is that it ends somewhere,
 * and a Hired chip that empties itself the moment somebody is hired would be a
 * chip that always reads zero.
 */
export async function listCandidates(now = new Date()): Promise<CandidateRow[]> {
  const rows = await db
    .select({
      id: person.id,
      name: person.fullName,
      trade: person.trade,
      appliedFor: person.appliedFor,
      mobility: person.mobility,
      wilaya: person.wilaya,
      source: person.source,
      stage: person.stage,
      relationship: person.relationship,
      receivedAt: person.createdAt,
    })
    .from(person)
    .where(
      and(
        isNull(person.deletedAt),
        sql`(${person.relationship} = ${CANDIDATE} or ${person.stage} is not null)`,
      ),
    )
    .orderBy(desc(person.createdAt));

  /**
   * The certifications come back in a second query and are matched in memory.
   *
   * The correlated sub-select that `shortlistsFor` uses returns NULL here, and
   * the difference is that there `person` is joined and here it is the FROM
   * table — the reference inside the sub-query stops correlating. That took a
   * failing test to find, and the fix is the one that cannot go wrong: ask for
   * the rows and pick the soonest in JavaScript, where "soonest" is one
   * comparison anybody can read.
   */
  const soonest = await soonestCertifications(rows.map((r) => r.id));

  return rows.map((row) => ({
    ...(soonest.get(row.id) ?? { certification: null, certificationExpiresOn: null }),
    id: row.id,
    name: row.name,
    trade: row.trade,
    appliedFor: row.appliedFor,
    mobility: row.mobility,
    wilaya: row.wilaya,
    source: row.source,
    stage: (row.stage as PersonStage) ?? "new",
    daysLeft: daysUntil(soonest.get(row.id)?.certificationExpiresOn ?? null, now),
    receivedAt: row.receivedAt,
    hired: row.relationship !== CANDIDATE,
  }));
}

/** The soonest-expiring certification each of these people holds. */
async function soonestCertifications(
  personIds: string[],
): Promise<Map<string, { certification: string | null; certificationExpiresOn: string | null }>> {
  const out = new Map<
    string,
    { certification: string | null; certificationExpiresOn: string | null }
  >();
  if (personIds.length === 0) return out;

  const rows = await db
    .select()
    .from(personCertification)
    .where(inArray(personCertification.personId, personIds));

  for (const row of rows) {
    const held = out.get(row.personId);
    // Nulls last: a certification with no expiry never beats one with a date,
    // because the question is which runs out first.
    const better =
      !held ||
      (row.expiresOn !== null &&
        (held.certificationExpiresOn === null || row.expiresOn < held.certificationExpiresOn));
    if (better) {
      out.set(row.personId, { certification: row.kind, certificationExpiresOn: row.expiresOn });
    }
  }
  return out;
}

/** Within this many days, a certification is worth a red row on screen 24. */
export const CERT_EXPIRING_DAYS = 30;

export async function candidateCounts(now = new Date()) {
  const rows = await listCandidates(now);
  const byStage = (stage: PersonStage) => rows.filter((r) => r.stage === stage).length;
  return {
    all: rows.length,
    new: byStage("new"),
    reviewing: byStage("reviewing"),
    shortlisted: byStage("shortlisted"),
    interview: byStage("interview"),
    hired: rows.filter((r) => r.hired || r.stage === "hired").length,
    archived: byStage("archived"),
    expiring: rows.filter(
      (r) => r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= CERT_EXPIRING_DAYS,
    ).length,
    /** The trades, for the discipline row. */
    trades: [...new Set(rows.map((r) => r.trade))].sort(),
  };
}

export async function setCandidateStage(opts: {
  personId: string;
  stage: PersonStage;
  actorId: string;
}): Promise<void> {
  const [before] = await db
    .select({ stage: person.stage })
    .from(person)
    .where(eq(person.id, opts.personId))
    .limit(1);
  if (!before) throw new RecruitmentRefused("noSuchPerson");

  // Screen 64's machine, enforced rather than drawn. A declared graph that
  // nothing checks is a diagram.
  assertTransition("person_stage", before.stage ?? "new", opts.stage);

  await db.transaction(async (tx) => {
    await tx.update(person).set({ stage: opts.stage }).where(eq(person.id, opts.personId));
    await tx.insert(auditEntry).values({
      entity: "person",
      entityId: opts.personId,
      action: "update",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "24",
      before: { stage: before.stage },
      after: { stage: opts.stage },
    });
  });
}

/**
 * Hiring somebody is a change of relationship, not a new record.
 *
 * The row keeps its trade, its phone number and every certification already
 * attached to it — which is the entire argument for candidates living in the
 * people table. Copying a person across on the day they are hired is the day
 * the two copies start to drift.
 */
export async function hire(opts: {
  personId: string;
  relationship?: "employee" | "temporary" | "daily";
  actorId: string;
}): Promise<void> {
  const [found] = await db.select().from(person).where(eq(person.id, opts.personId)).limit(1);
  if (!found) throw new RecruitmentRefused("noSuchPerson");
  if (found.relationship !== CANDIDATE) throw new RecruitmentRefused("notACandidate");

  await db.transaction(async (tx) => {
    await tx
      .update(person)
      .set({ relationship: opts.relationship ?? "employee", stage: "hired" })
      .where(eq(person.id, opts.personId));

    await tx.insert(auditEntry).values({
      entity: "person",
      entityId: opts.personId,
      action: "update",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "25",
      before: { relationship: found.relationship, stage: found.stage },
      after: { relationship: opts.relationship ?? "employee", stage: "hired" },
    });
  });
}

/* --------------------------------------------------- personnel requests */

export async function nextRequestRef(tx: typeof db, when: Date): Promise<string> {
  const year = when.getUTCFullYear();
  const [row] = await tx
    .select({
      n: sql<number>`coalesce(max(substring(${personnelRequest.ref} from 10)::int), 0)::int`,
    })
    .from(personnelRequest)
    .where(sql`${personnelRequest.ref} like ${`REQ-${year}-%`}`);
  return `REQ-${year}-${String((row?.n ?? 0) + 1).padStart(3, "0")}`;
}

export async function createRequest(opts: {
  role: string;
  projectId?: string | null;
  wilaya?: string | null;
  needed?: number;
  startOn?: string | null;
  certificationRequired?: boolean;
  note?: string | null;
  actorId: string;
}): Promise<string> {
  if (!opts.role.trim()) throw new RecruitmentRefused("roleRequired");
  if ((opts.needed ?? 1) < 1) throw new RecruitmentRefused("neededAtLeastOne");

  return db.transaction(async (tx) => {
    const ref = await nextRequestRef(tx as unknown as typeof db, new Date());
    const [row] = await tx
      .insert(personnelRequest)
      .values({
        ref,
        role: opts.role.trim(),
        projectId: opts.projectId ?? null,
        wilaya: opts.wilaya ?? null,
        needed: opts.needed ?? 1,
        startOn: opts.startOn ?? null,
        certificationRequired: opts.certificationRequired ?? false,
        note: opts.note ?? null,
        createdBy: opts.actorId,
      })
      .returning({ id: personnelRequest.id });

    await tx.insert(auditEntry).values({
      entity: "personnel_request",
      entityId: row?.id as string,
      action: "create",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "26",
      after: { ref, role: opts.role.trim(), needed: opts.needed ?? 1 },
    });

    return row?.id as string;
  });
}

export type RequestRow = {
  id: string;
  ref: string;
  role: string;
  projectId: string | null;
  projectCode: string | null;
  projectObject: string | null;
  wilaya: string | null;
  startOn: string | null;
  certificationRequired: boolean;
  note: string | null;
  request: Request;
  shortlist: ShortlistRow[];
};

async function shortlistsFor(requestIds: string[]): Promise<Map<string, ShortlistEntry[]>> {
  const out = new Map<string, ShortlistEntry[]>();
  for (const id of requestIds) out.set(id, []);
  if (requestIds.length === 0) return out;

  const rows = await db
    .select({
      requestId: personnelCandidate.requestId,
      id: personnelCandidate.id,
      personId: person.id,
      name: person.fullName,
      trade: person.trade,
      mobility: person.mobility,
      stage: personnelCandidate.stage,
      ...soonestCertification,
    })
    .from(personnelCandidate)
    .innerJoin(person, eq(person.id, personnelCandidate.personId))
    .where(inArray(personnelCandidate.requestId, requestIds))
    .orderBy(asc(person.fullName));

  for (const row of rows) {
    out.get(row.requestId)?.push({
      id: row.id,
      personId: row.personId,
      name: row.name,
      trade: row.trade,
      mobility: row.mobility,
      stage: row.stage as CandidateStage,
      certification: row.certification,
      certificationExpiresOn: row.certificationExpiresOn,
    });
  }
  return out;
}

export async function listRequests(now = new Date()): Promise<RequestRow[]> {
  const rows = await db
    .select({
      id: personnelRequest.id,
      ref: personnelRequest.ref,
      role: personnelRequest.role,
      projectId: personnelRequest.projectId,
      projectCode: project.code,
      projectObject: project.object,
      wilaya: personnelRequest.wilaya,
      needed: personnelRequest.needed,
      startOn: personnelRequest.startOn,
      certificationRequired: personnelRequest.certificationRequired,
      status: personnelRequest.status,
      note: personnelRequest.note,
    })
    .from(personnelRequest)
    .leftJoin(project, eq(project.id, personnelRequest.projectId))
    .orderBy(asc(personnelRequest.startOn), desc(personnelRequest.ref));

  const shortlists = await shortlistsFor(rows.map((r) => r.id));

  return rows.map((row) => {
    const shortlist = readShortlist({
      entries: shortlists.get(row.id) ?? [],
      startOn: row.startOn,
      now,
    });
    return {
      id: row.id,
      ref: row.ref,
      role: row.role,
      projectId: row.projectId,
      projectCode: row.projectCode,
      projectObject: row.projectObject,
      wilaya: row.wilaya,
      startOn: row.startOn,
      certificationRequired: row.certificationRequired,
      note: row.note,
      shortlist,
      request: readRequest({
        needed: row.needed,
        startOn: row.startOn,
        status: row.status,
        certificationRequired: row.certificationRequired,
        shortlist,
        now,
      }),
    };
  });
}

export async function requestCounts(now = new Date()) {
  const rows = await listRequests(now);
  return {
    all: rows.length,
    open: rows.filter((r) => r.request.state === "open" || r.request.state === "urgent").length,
    filled: rows.filter((r) => r.request.state === "filled").length,
    cancelled: rows.filter((r) => r.request.state === "cancelled").length,
    late: rows.filter((r) => r.request.state === "late").length,
    positions: rows
      .filter((r) => r.request.state !== "filled" && r.request.state !== "cancelled")
      .reduce((total, row) => total + (row.request.needed - row.request.usable), 0),
    withinSeven: rows.filter(
      (r) =>
        r.request.state !== "filled" &&
        r.request.state !== "cancelled" &&
        r.request.daysToStart !== null &&
        r.request.daysToStart >= 0 &&
        r.request.daysToStart <= 7,
    ).length,
  };
}

/** Put somebody on a request's shortlist. */
export async function shortlist(opts: {
  requestId: string;
  personId: string;
  stage?: CandidateStage;
  actorId: string;
}): Promise<void> {
  const [already] = await db
    .select({ id: personnelCandidate.id })
    .from(personnelCandidate)
    .where(
      and(
        eq(personnelCandidate.requestId, opts.requestId),
        eq(personnelCandidate.personId, opts.personId),
      ),
    )
    .limit(1);
  if (already) throw new RecruitmentRefused("alreadyOnShortlist");

  await db.insert(personnelCandidate).values({
    requestId: opts.requestId,
    personId: opts.personId,
    stage: opts.stage ?? "new",
    addedBy: opts.actorId,
  });
}

/**
 * Move somebody along, or out.
 *
 * `rejected` takes a reason, the same rule the go/no-go card follows: a
 * decision recorded without one teaches nobody anything six months later, and
 * this is a decision about a person.
 */
export async function decideCandidate(opts: {
  candidateId: string;
  stage: CandidateStage;
  reason?: string | null;
  actorId: string;
}): Promise<void> {
  if (opts.stage === "rejected" && !opts.reason?.trim()) {
    throw new RecruitmentRefused("reasonRequired");
  }

  const [before] = await db
    .select()
    .from(personnelCandidate)
    .where(eq(personnelCandidate.id, opts.candidateId))
    .limit(1);
  if (!before) throw new RecruitmentRefused("noSuchCandidate");

  assertTransition("personnel_candidate", before.stage, opts.stage);

  await db.transaction(async (tx) => {
    await tx
      .update(personnelCandidate)
      .set({
        stage: opts.stage,
        rejectedReason: opts.stage === "rejected" ? (opts.reason?.trim() ?? null) : null,
        decidedAt: new Date(),
      })
      .where(eq(personnelCandidate.id, opts.candidateId));

    await tx.insert(auditEntry).values({
      entity: "personnel_request",
      entityId: before.requestId,
      action: "update",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "26",
      before: { stage: before.stage },
      after: { stage: opts.stage, personId: before.personId, reason: opts.reason?.trim() ?? null },
    });
  });
}

export async function cancelRequest(opts: {
  requestId: string;
  reason: string;
  actorId: string;
}): Promise<void> {
  if (!opts.reason.trim()) throw new RecruitmentRefused("reasonRequired");
  await db.transaction(async (tx) => {
    await tx
      .update(personnelRequest)
      .set({ status: "cancelled", cancelledReason: opts.reason.trim() })
      .where(eq(personnelRequest.id, opts.requestId));
    await tx.insert(auditEntry).values({
      entity: "personnel_request",
      entityId: opts.requestId,
      action: "update",
      actorId: opts.actorId,
      actorKind: "user",
      sourceScreen: "26",
      after: { status: "cancelled", reason: opts.reason.trim() },
    });
  });
}

/** Two different people touch one ticket: whoever typed it, whoever saw it. */
const recorder = alias(user, "recorder");

/** Screen 25 — one candidate, with what they are being considered for. */
export async function getCandidate(id: string, now = new Date()) {
  const [row] = await db
    .select({
      id: person.id,
      name: person.fullName,
      trade: person.trade,
      appliedFor: person.appliedFor,
      mobility: person.mobility,
      wilaya: person.wilaya,
      phone: person.phone,
      email: person.email,
      source: person.source,
      relationship: person.relationship,
      stage: person.stage,
      employer: sql<string | null>`(
        select coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})
        from ${party} where ${party.id} = ${person.employerPartyId}
      )`,
      receivedAt: person.createdAt,
    })
    .from(person)
    .where(eq(person.id, id))
    .limit(1);

  if (!row) return null;

  /*
    "Checked" is a person having seen the original, so the row carries who and
    when and the screen computes the rest. It was `is_verified boolean` with
    nothing anywhere able to set it, so every ticket in the company read "Non
    contrôlée" for ever. LEFT on the user, like the audit trail: a check made by
    somebody who has since left is still a check that was made.
  */
  const certifications = await db
    .select({
      id: personCertification.id,
      kind: personCertification.kind,
      number: personCertification.number,
      issuedBy: personCertification.issuedBy,
      issuedOn: personCertification.issuedOn,
      expiresOn: personCertification.expiresOn,
      verifiedAt: personCertification.verifiedAt,
      verifiedByName: user.name,
      // Who typed it in. Shown only while the ticket is UNCHECKED, because
      // that is the one moment it answers a question somebody actually has:
      // who do I ask for the original.
      recordedByName: recorder.name,
      recordedAt: personCertification.createdAt,
    })
    .from(personCertification)
    .leftJoin(user, eq(user.id, personCertification.verifiedBy))
    .leftJoin(recorder, eq(recorder.id, personCertification.recordedBy))
    .where(eq(personCertification.personId, id))
    .orderBy(asc(personCertification.expiresOn));

  const considered = await db
    .select({
      candidateId: personnelCandidate.id,
      stage: personnelCandidate.stage,
      requestId: personnelRequest.id,
      ref: personnelRequest.ref,
      role: personnelRequest.role,
      wilaya: personnelRequest.wilaya,
      startOn: personnelRequest.startOn,
      certificationRequired: personnelRequest.certificationRequired,
    })
    .from(personnelCandidate)
    .innerJoin(personnelRequest, eq(personnelRequest.id, personnelCandidate.requestId))
    .where(eq(personnelCandidate.personId, id))
    .orderBy(desc(personnelRequest.ref));

  return {
    ...row,
    stage: (row.stage as PersonStage) ?? "new",
    hired: row.relationship !== CANDIDATE,
    certifications: certifications.map((c) => ({
      ...c,
      daysLeft: daysUntil(c.expiresOn, now),
      /** Computed, never stored. A date is the fact; this is how it reads. */
      verified: c.verifiedAt !== null,
      verifiedOn: c.verifiedAt ? c.verifiedAt.toISOString().slice(0, 10) : null,
      recordedOn: c.recordedAt ? c.recordedAt.toISOString().slice(0, 10) : null,
    })),
    considered,
  };
}

/** People who could be put on a request: the right trade, not already on it. */
export async function availableFor(requestId: string, role: string) {
  const on = await db
    .select({ personId: personnelCandidate.personId })
    .from(personnelCandidate)
    .where(eq(personnelCandidate.requestId, requestId));
  const taken = on.map((r) => r.personId);

  return db
    .select({ id: person.id, name: person.fullName, trade: person.trade })
    .from(person)
    .where(
      and(
        isNull(person.deletedAt),
        ne(person.relationship, "external"),
        sql`${person.trade} ilike ${`%${role}%`}`,
        taken.length > 0 ? sql`${person.id} <> all(${taken})` : sql`true`,
      ),
    )
    .orderBy(asc(person.fullName))
    .limit(50);
}
