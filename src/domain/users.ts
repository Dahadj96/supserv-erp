import { desc, eq, sql } from "drizzle-orm";
import { ROLES, type Role } from "@/auth/can";
import { db } from "@/db";
import { session, user, userRole } from "@/db/schema/auth";
import { auditEntry } from "@/db/schema/control";

/**
 * Screen 30 — Users and roles.
 *
 * "Sign-in is handled by Microsoft 365 — no passwords are stored here." Entra
 * says who you are; this file says what you may do, and the two never touch.
 *
 * A colleague is not invited here. They appear the first time they sign in with
 * their Microsoft account, carrying NO role — because a company account is not
 * an entitlement, and somebody has to decide. That decision is the only thing
 * this screen actually does, and it is recorded with a name and a date.
 */

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role | null;
  assignedBy: string | null;
  assignedByName: string | null;
  assignedAt: Date | null;
  lastSeen: Date | null;
};

function isRole(value: string): value is Role {
  return Object.keys(ROLES).includes(value);
}

export async function listUsers(): Promise<UserRow[]> {
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: userRole.role,
      assignedBy: userRole.assignedBy,
      assignedAt: userRole.assignedAt,
      // LAW 1 — "last seen" is not a column somebody writes. It is the newest
      // session this person holds, worked out when the screen asks.
      lastSeen: sql<Date | null>`(
        select max(${session.createdAt}) from ${session} where ${session.userId} = ${user.id}
      )`,
    })
    .from(user)
    .leftJoin(userRole, eq(userRole.userId, user.id))
    .orderBy(user.name);

  const names = new Map(rows.map((r) => [r.id, r.name]));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role && isRole(row.role) ? row.role : null,
    assignedBy: row.assignedBy,
    assignedByName: row.assignedBy ? (names.get(row.assignedBy) ?? null) : null,
    assignedAt: row.assignedAt,
    lastSeen: row.lastSeen ? new Date(row.lastSeen) : null,
  }));
}

/** Why a role change was refused. Screen 80: never a grey control without one. */
export class RoleRefused extends Error {
  constructor(readonly reason: "unknownRole" | "self" | "lastGerant" | "noSuchUser") {
    super(reason);
  }
}

/**
 * The two refusals, as arithmetic, so they can be tested without a database
 * holding exactly the right number of Gérants at the time.
 *
 *   · You cannot change your own role. Otherwise a Gérant demotes himself by
 *     mistake and nobody left can put it back — the system is locked with all
 *     the data still in it.
 *   · You cannot take the role off the last Gérant, which is the same accident
 *     approached from the other side.
 *
 * Everything else is allowed. At six people the person doing this is the owner,
 * and the audit entry is the control — not a confirmation dialog.
 */
export function refuse(input: {
  targetUserId: string;
  actorId: string;
  current: Role | null;
  next: Role | null;
  gerantCount: number;
}): RoleRefused["reason"] | null {
  const { targetUserId, actorId, current, next, gerantCount } = input;

  if (next !== null && !isRole(next)) return "unknownRole";
  if (targetUserId === actorId) return "self";
  if (current === "gerant" && next !== "gerant" && gerantCount <= 1) return "lastGerant";
  return null;
}

async function countGerants(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userRole)
    .where(eq(userRole.role, "gerant"));
  return row?.count ?? 0;
}

/** Give somebody a role, or take it away with `next = null`. See `refuse`. */
export async function assignRole(
  targetUserId: string,
  next: Role | null,
  actorId: string,
): Promise<void> {
  const [target] = await db.select().from(user).where(eq(user.id, targetUserId)).limit(1);
  if (!target) throw new RoleRefused("noSuchUser");

  const [current] = await db
    .select()
    .from(userRole)
    .where(eq(userRole.userId, targetUserId))
    .limit(1);

  const reason = refuse({
    targetUserId,
    actorId,
    current: current?.role && isRole(current.role) ? current.role : null,
    next,
    gerantCount: await countGerants(),
  });
  if (reason) throw new RoleRefused(reason);

  if (next === null) {
    await db.delete(userRole).where(eq(userRole.userId, targetUserId));
  } else {
    await db
      .insert(userRole)
      .values({ userId: targetUserId, role: next, assignedBy: actorId })
      .onConflictDoUpdate({
        target: userRole.userId,
        set: { role: next, assignedBy: actorId, assignedAt: new Date() },
      });
  }

  await db.insert(auditEntry).values({
    actorId,
    actorKind: "user",
    entity: "user_role",
    entityId: targetUserId,
    action: next === null ? "revoke" : "assign",
    before: { role: current?.role ?? null },
    after: { role: next, email: target.email },
    sourceScreen: "30",
  });
}

/** Screen 32 reads the same rows; screen 30 shows the last few inline. */
export async function roleHistory(limit = 20) {
  return db
    .select()
    .from(auditEntry)
    .where(eq(auditEntry.entity, "user_role"))
    .orderBy(desc(auditEntry.at))
    .limit(limit);
}
