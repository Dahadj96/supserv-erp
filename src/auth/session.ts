import "server-only";
import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { userRole } from "@/db/schema/auth";
import { userPreference } from "@/db/schema/interface";
import type { Role } from "./can";
import { ROLES } from "./can";
import { auth } from "./index";

/**
 * THE ONE PLACE THE APP LEARNS WHO IS SIGNED IN.
 *
 * Entra ID answers "who", `user_role` answers "what may they do", and
 * `user_preference` answers "in which language do they see it". Nothing else
 * in the app reads a cookie or a header to find out.
 */
export type Session = {
  userId: string;
  displayName: string;
  email: string;
  /** null means signed in but not yet given a role — see screen 30. */
  role: Role | null;
  uiLocale: string;
};

function isRole(value: string): value is Role {
  return Object.keys(ROLES).includes(value);
}

export async function getSession(): Promise<Session | null> {
  const result = await auth.api.getSession({ headers: await headers() });
  if (!result?.user) return null;

  const { id, name, email } = result.user;

  const [assigned] = await db
    .select({ role: userRole.role })
    .from(userRole)
    .where(eq(userRole.userId, id))
    .limit(1);

  let role: Role | null = assigned && isRole(assigned.role) ? assigned.role : null;

  // Bootstrap: the very first person to sign in becomes Gérant, otherwise the
  // system is born locked with nobody able to grant anyone anything. Everyone
  // after that arrives with no role and must be given one on screen 30 —
  // a colleague's Entra account is not an entitlement.
  if (!role) {
    const rows = await db.select({ count: sql<number>`count(*)::int` }).from(userRole);
    if ((rows[0]?.count ?? 0) === 0) {
      await db.insert(userRole).values({ userId: id, role: "gerant" });
      role = "gerant";
    }
  }

  const [pref] = await db
    .select({ uiLocale: userPreference.uiLocale })
    .from(userPreference)
    .where(eq(userPreference.userId, id))
    .limit(1);

  return {
    userId: id,
    displayName: name || email,
    email,
    role,
    uiLocale: pref?.uiLocale ?? "fr",
  };
}
