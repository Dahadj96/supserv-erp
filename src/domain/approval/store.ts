import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { approvalGate, approvalRequest } from "@/db/schema/approval";
import { auditEntry } from "@/db/schema/control";
import {
  type ApprovalRequest,
  checkDecision,
  checkRequest,
  DEFAULT_GATES,
  type Gate,
  type GateCode,
  isSelfApproval,
  type Refusal,
  type RequestStatus,
} from "./gates";

/**
 * Screen 65 — the database half.
 *
 * A gate WRITES BEFORE the action, the audit log writes after. Both are written
 * here, in that order and in the same transaction where it matters, because a
 * decision that was made and not logged is a decision nobody can find in six
 * months — which is the only reason the gate exists.
 */

export class NotAllowed extends Error {
  constructor(readonly why: Refusal) {
    super(why);
  }
}

/** The gates, seeded on first read so the Rules tab has something to show. */
export async function gates(): Promise<Gate[]> {
  const rows = await db.select().from(approvalGate).orderBy(approvalGate.position);
  if (rows.length === 0) {
    await db.insert(approvalGate).values(DEFAULT_GATES);
    return DEFAULT_GATES;
  }
  return rows.map((row) => ({
    code: row.code as GateCode,
    role: row.role,
    threshold: row.threshold,
    requiresReasonCode: row.requiresReasonCode,
    requiresJustification: row.requiresJustification,
    enabled: row.enabled,
    position: row.position,
  }));
}

function shape(row: typeof approvalRequest.$inferSelect): ApprovalRequest {
  return {
    id: row.id,
    gateCode: row.gateCode as GateCode,
    entity: row.entity,
    entityId: row.entityId,
    subject: row.subject,
    before: (row.before ?? null) as ApprovalRequest["before"],
    after: (row.after ?? null) as ApprovalRequest["after"],
    reasonCode: row.reasonCode,
    justification: row.justification,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt,
    status: row.status as RequestStatus,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    selfApproved: row.selfApproved,
  };
}

export async function requests(opts: { status?: RequestStatus; since?: Date } = {}) {
  const rows = await db
    .select()
    .from(approvalRequest)
    .where(
      and(
        opts.status ? eq(approvalRequest.status, opts.status) : sql`true`,
        opts.since ? gte(approvalRequest.requestedAt, opts.since) : sql`true`,
      ),
    )
    .orderBy(desc(approvalRequest.requestedAt));
  return rows.map(shape);
}

/**
 * Ask for permission.
 *
 * `before` and `after` are frozen onto the row. Six weeks later the before may
 * no longer exist — the offer was re-priced, the quote expired — and showing
 * today's values against an August decision would be reconstructing history,
 * the exact thing this table exists to avoid.
 */
export async function request(opts: {
  gateCode: GateCode;
  entity: string;
  entityId: string;
  subject: string;
  before?: Record<string, string | null> | null;
  after?: Record<string, string | null> | null;
  reasonCode?: string | null;
  justification?: string | null;
  actorId: string;
}): Promise<string> {
  const gate = (await gates()).find((row) => row.code === opts.gateCode);
  const refusal = checkRequest({
    gate,
    reasonCode: opts.reasonCode ?? null,
    justification: opts.justification ?? null,
  });
  if (refusal) throw new NotAllowed(refusal);

  const [created] = await db
    .insert(approvalRequest)
    .values({
      gateCode: opts.gateCode,
      entity: opts.entity,
      entityId: opts.entityId,
      subject: opts.subject,
      before: opts.before ?? null,
      after: opts.after ?? null,
      reasonCode: opts.reasonCode?.trim() || null,
      justification: opts.justification?.trim() || null,
      requestedBy: opts.actorId,
    })
    .returning({ id: approvalRequest.id });

  const id = created?.id as string;
  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "approval_request",
    entityId: id,
    action: "create",
    after: {
      gate: opts.gateCode,
      blocks: `${opts.entity}:${opts.entityId}`,
      reasonCode: opts.reasonCode ?? null,
      // Named so the log answers "was this ever actually decided?" on its own.
      decided: false,
    },
    sourceScreen: "65",
  });
  return id;
}

/**
 * Decide it.
 *
 * A decline is not a dead end — screen 65: "the draft stays, nothing is lost".
 * Nothing here touches the thing being gated; it only records the answer, and
 * whatever was blocked reads this row next time somebody tries.
 */
export async function decide(opts: {
  requestId: string;
  approve: boolean;
  note?: string | null;
  role: string | null;
  actorId: string;
}): Promise<void> {
  const [row] = await db
    .select()
    .from(approvalRequest)
    .where(eq(approvalRequest.id, opts.requestId))
    .limit(1);
  if (!row) throw new NotAllowed("gateNotFound");

  const current = shape(row);
  const gate = (await gates()).find((g) => g.code === current.gateCode);
  const refusal = checkDecision({ gate, request: current, role: opts.role });
  if (refusal) throw new NotAllowed(refusal);

  // Allowed, and always recorded as such. In this company the Gérant IS the
  // Commercial most days; a gate that refused would be one somebody routes
  // around by not asking, which loses the record entirely.
  const self = isSelfApproval(current, opts.actorId);
  const status: RequestStatus = opts.approve ? "approved" : "declined";
  const at = new Date();

  await db
    .update(approvalRequest)
    .set({
      status,
      decidedBy: opts.actorId,
      decidedAt: at,
      decisionNote: opts.note?.trim() || null,
      selfApproved: self,
    })
    .where(eq(approvalRequest.id, opts.requestId));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "approval_request",
    entityId: opts.requestId,
    action: "update",
    before: { status: "waiting" },
    after: {
      status,
      gate: current.gateCode,
      blocks: `${current.entity}:${current.entityId}`,
      selfApproved: self,
      // The sentence, in the log as well as on the row. This is the thing
      // somebody reads in six months.
      justification: current.justification,
      note: opts.note ?? null,
    },
    reason: current.reasonCode,
    sourceScreen: "65",
  });
}

/**
 * Is this thing cleared to proceed?
 *
 * The question every gated action asks before it acts. Nothing is cleared by
 * default: no row means nobody asked, and "nobody asked" is not permission.
 */
export async function isCleared(entity: string, entityId: string, gateCode: GateCode) {
  const [row] = await db
    .select({ status: approvalRequest.status })
    .from(approvalRequest)
    .where(
      and(
        eq(approvalRequest.entity, entity),
        eq(approvalRequest.entityId, entityId),
        eq(approvalRequest.gateCode, gateCode),
      ),
    )
    .orderBy(desc(approvalRequest.requestedAt))
    .limit(1);

  return row?.status === "approved";
}
