import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { userPreference } from "@/db/schema/interface";
import type { Role } from "./can";
import { ROLES } from "./can";

/**
 * THE SEAM FOR SIGN-IN.
 *
 * Real sign-in is Better Auth + Entra ID (STACK.md). It is not wired yet, so
 * development uses a cookie that names a role. Everything else in the app —
 * `can()`, preferences, the avatar menu — reads the session through this file
 * and nothing else, so swapping in Better Auth means rewriting `getSession`
 * and deleting `signInAsDevUser`. No caller changes.
 *
 * Tailscale is transport, never identity: never read a Tailscale header here.
 */
const COOKIE = "supserv_dev_role";

/** Dev sign-in must never be reachable from a built production server. */
export const DEV_AUTH_ENABLED = process.env.NODE_ENV !== "production";

export type Session = {
  userId: string;
  displayName: string;
  role: Role;
  uiLocale: string;
};

/** A stable uuid per role so preferences persist across restarts in dev. */
const DEV_USER_IDS: Record<Role, string> = {
  gerant: "00000000-0000-4000-8000-000000000001",
  commercial: "00000000-0000-4000-8000-000000000002",
  achats: "00000000-0000-4000-8000-000000000003",
  chantier: "00000000-0000-4000-8000-000000000004",
  compta: "00000000-0000-4000-8000-000000000005",
  lecture: "00000000-0000-4000-8000-000000000006",
};

export function isRole(value: string): value is Role {
  return Object.keys(ROLES).includes(value);
}

export async function getSession(): Promise<Session | null> {
  if (!DEV_AUTH_ENABLED) {
    // Better Auth goes here. Until then a production build has no session and
    // every page must send the person to sign in rather than guess who they are.
    return null;
  }

  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw || !isRole(raw)) return null;

  const userId = DEV_USER_IDS[raw];
  const [pref] = await db
    .select({ uiLocale: userPreference.uiLocale })
    .from(userPreference)
    .where(eq(userPreference.userId, userId))
    .limit(1);

  return {
    userId,
    displayName: "A. Dahadj",
    role: raw,
    uiLocale: pref?.uiLocale ?? "fr",
  };
}
