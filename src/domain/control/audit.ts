import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema/auth";
import { auditEntry } from "@/db/schema/control";

/**
 * Screen 32 — the audit log.
 *
 * PLAN §3.6: an audit entry outlives the record it describes. `discardParty`
 * puts a company in the bin for thirty days and then the row may go, but the
 * entry saying it existed and why it went does not — which is the whole reason
 * this table has its own id sequence and no foreign keys.
 *
 * The table is append-only. Nothing in this module writes to it and nothing
 * anywhere updates or deletes a row: sixty-four call sites insert, and that is
 * the complete set of operations. A log that can be edited is not a log.
 */

/** Who acted. LAW 6 makes the third one interesting: the assistant is named. */
export const ACTOR_KINDS = ["user", "assistant", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export function isActorKind(value: string | undefined): value is ActorKind {
  return Boolean(value) && ACTOR_KINDS.includes(value as ActorKind);
}

export type Change = {
  field: string;
  before: string | null;
  after: string | null;
};

export type AuditRow = {
  id: number;
  at: Date;
  actorId: string | null;
  /** The person's name if the id still resolves to one, else the raw id. */
  actorName: string | null;
  actorKind: string;
  entity: string;
  entityId: string | null;
  action: string;
  reason: string | null;
  sourceScreen: string | null;
  changes: Change[];
  /** True when before/after were recorded but nothing in them differs. */
  recordedNoChange: boolean;
};

/** How a value is shown in the diff. Never `[object Object]`. */
function display(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v) => display(v) ?? "—").join(", ");
  return JSON.stringify(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * What actually changed, field by field.
 *
 * "Who changed the relance wording and when" is only answerable if the screen
 * shows WHAT changed, and the two jsonb columns are written by sixty-four call
 * sites with no agreed shape between them. Some record the whole row, some
 * record two fields, some record only `after` (a creation) or only `before`
 * (a discard). All four shapes have to produce something readable.
 *
 * A field present in one side and absent from the other is a change to or from
 * nothing — which is different from a field present in both and equal, and the
 * caller is told the difference so it can say "recorded, nothing differed"
 * rather than printing an empty diff and looking broken.
 */
export function changedFields(before: unknown, after: unknown): Change[] {
  const a = asRecord(before);
  const b = asRecord(after);
  if (!a && !b) return [];

  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort();

  const changes: Change[] = [];
  for (const field of keys) {
    const from = display(a?.[field]);
    const to = display(b?.[field]);
    if (from === to) continue;
    changes.push({ field, before: from, after: to });
  }
  return changes;
}

export type AuditFilter = {
  entity?: string;
  actorKind?: ActorKind;
  /** Inclusive. Both optional; either alone is a valid half-open range. */
  since?: Date;
  until?: Date;
};

export const PAGE = 100;

function where(filter: AuditFilter) {
  const parts = [
    filter.entity ? eq(auditEntry.entity, filter.entity) : undefined,
    filter.actorKind ? eq(auditEntry.actorKind, filter.actorKind) : undefined,
    filter.since ? gte(auditEntry.at, filter.since) : undefined,
    filter.until ? lt(auditEntry.at, filter.until) : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? and(...parts) : undefined;
}

export async function listAudit(
  filter: AuditFilter = {},
  page = 0,
): Promise<{ rows: AuditRow[]; more: boolean }> {
  // One extra row, purely to answer "is there another page" without a count(*)
  // over a table that only ever grows.
  const raw = await db
    .select({
      id: auditEntry.id,
      at: auditEntry.at,
      actorId: auditEntry.actorId,
      actorName: user.name,
      actorKind: auditEntry.actorKind,
      entity: auditEntry.entity,
      entityId: auditEntry.entityId,
      action: auditEntry.action,
      before: auditEntry.before,
      after: auditEntry.after,
      reason: auditEntry.reason,
      sourceScreen: auditEntry.sourceScreen,
    })
    .from(auditEntry)
    // LEFT, not INNER. An entry whose actor has since been removed from the
    // directory must still appear — that is precisely the entry somebody will
    // be looking for.
    .leftJoin(user, eq(auditEntry.actorId, user.id))
    .where(where(filter))
    .orderBy(desc(auditEntry.at), desc(auditEntry.id))
    .limit(PAGE + 1)
    .offset(page * PAGE);

  const more = raw.length > PAGE;

  const rows = raw.slice(0, PAGE).map((r) => {
    const changes = changedFields(r.before, r.after);
    return {
      id: r.id,
      at: r.at,
      actorId: r.actorId,
      actorName: r.actorName ?? r.actorId,
      actorKind: r.actorKind,
      entity: r.entity,
      entityId: r.entityId,
      action: r.action,
      reason: r.reason,
      sourceScreen: r.sourceScreen,
      changes,
      recordedNoChange: changes.length === 0 && (r.before !== null || r.after !== null),
    };
  });

  return { rows, more };
}

export type Facet = { key: string; count: number };

/**
 * The entities and actor kinds that actually appear, with counts.
 *
 * Read from the table rather than from a list in code, because a list in code
 * would show `assistant` as a filter on a system where the assistant has never
 * run — a chip that can only read zero. When the assistant starts writing
 * entries the chip appears on its own.
 */
export async function auditFacets(): Promise<{
  entities: Facet[];
  actorKinds: Facet[];
  total: number;
}> {
  const [entities, actorKinds, [totals]] = await Promise.all([
    db
      .select({ key: auditEntry.entity, count: sql<number>`count(*)::int` })
      .from(auditEntry)
      .groupBy(auditEntry.entity)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({ key: auditEntry.actorKind, count: sql<number>`count(*)::int` })
      .from(auditEntry)
      .groupBy(auditEntry.actorKind)
      .orderBy(desc(sql`count(*)`)),
    db.select({ n: sql<number>`count(*)::int` }).from(auditEntry),
  ]);

  return { entities, actorKinds, total: totals?.n ?? 0 };
}

/**
 * The oldest entry, which is how far back the log actually reaches.
 *
 * Worth printing. "Complete audit trail" is a claim; "since 19 August 2026" is
 * a fact, and it is the one that tells somebody whether the answer they are
 * looking for could possibly be in here.
 */
export async function auditReachesBackTo(): Promise<Date | null> {
  const [row] = await db
    .select({ at: auditEntry.at })
    .from(auditEntry)
    .orderBy(auditEntry.at)
    .limit(1);
  return row?.at ?? null;
}
