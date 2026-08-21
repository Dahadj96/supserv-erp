import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { user, userRole } from "@/db/schema/auth";
import { auditEntry } from "@/db/schema/control";
import { assignRole, listUsers, RoleRefused } from "@/domain/users";

/**
 * Screen 30 — the assignment itself.
 *
 * The refusals are arithmetic and live in tests/unit/role-guards.test.ts. What
 * needs a database is the part that writes: the role lands, the previous one is
 * recorded, and "who gave them that" has an answer afterwards.
 *
 * Nothing here touches a real person's row. Two throwaway users are created and
 * removed, and the assertions are scoped to their ids.
 */
const A = "test-user-a";
const B = "test-user-b";
const IDS = [A, B];

beforeAll(async () => {
  await db.delete(userRole).where(inArray(userRole.userId, IDS));
  await db.delete(user).where(inArray(user.id, IDS));

  await db.insert(user).values([
    { id: A, name: "Test Alpha", email: "test-alpha@example.invalid" },
    { id: B, name: "Test Beta", email: "test-beta@example.invalid" },
  ]);
});

afterAll(async () => {
  await db.delete(auditEntry).where(inArray(auditEntry.entityId, IDS));
  await db.delete(userRole).where(inArray(userRole.userId, IDS));
  await db.delete(user).where(inArray(user.id, IDS));
});

const roleOf = async (id: string) => {
  const [row] = await db.select().from(userRole).where(eq(userRole.userId, id)).limit(1);
  return row ?? null;
};

describe("giving somebody a role", () => {
  it("lands the role and names who gave it", async () => {
    await assignRole(A, "commercial", B);

    const row = await roleOf(A);
    expect(row?.role).toBe("commercial");
    expect(row?.assignedBy, "who gave them that is an audit question").toBe(B);
    expect(row?.assignedAt).toBeInstanceOf(Date);
  });

  it("records the change, with what it was before", async () => {
    await assignRole(A, "compta", B);

    const [entry] = await db
      .select()
      .from(auditEntry)
      .where(and(eq(auditEntry.entityId, A), eq(auditEntry.action, "assign")))
      .orderBy(auditEntry.id);

    expect(entry?.sourceScreen).toBe("30");
    expect(entry?.actorId).toBe(B);
    expect((entry?.before as { role: string | null })?.role).toBeNull();
    expect((entry?.after as { role: string })?.role).toBe("commercial");
  });

  it("shows up in the list with the role and the name of whoever gave it", async () => {
    const rows = await listUsers();
    const alpha = rows.find((r) => r.id === A);

    expect(alpha?.role).toBe("compta");
    expect(alpha?.assignedByName).toBe("Test Beta");
    expect(alpha?.lastSeen, "this one has never signed in").toBeNull();
  });

  it("takes a role away, and the row goes rather than holding an empty string", async () => {
    await assignRole(A, null, B);

    expect(await roleOf(A)).toBeNull();
    const rows = await listUsers();
    expect(rows.find((r) => r.id === A)?.role).toBeNull();
  });

  it("records the revoke too", async () => {
    const entries = await db
      .select()
      .from(auditEntry)
      .where(and(eq(auditEntry.entityId, A), eq(auditEntry.action, "revoke")));

    expect(entries.length).toBe(1);
    expect((entries[0]?.before as { role: string })?.role).toBe("compta");
    expect((entries[0]?.after as { role: string | null })?.role).toBeNull();
  });

  it("refuses somebody who is not there", async () => {
    await expect(assignRole("test-user-nobody", "lecture", B)).rejects.toBeInstanceOf(RoleRefused);
  });

  it("writes nothing when it refuses", async () => {
    await assignRole(A, "lecture", B);
    await expect(assignRole(A, "gerant", A)).rejects.toMatchObject({ reason: "self" });

    expect((await roleOf(A))?.role, "the refusal left the old role alone").toBe("lecture");
  });
});
