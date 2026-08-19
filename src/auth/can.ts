/**
 * ONE choke point for permissions. Not scattered through components.
 *
 * There is no Supabase and therefore no RLS convenience layer, which is fine at
 * six users — but it means this file is the only thing standing between a user
 * and data they may not see. Every server action calls it. No exceptions.
 */
export const PERMISSIONS = [
  "offers.margin.view",
  "offers.issue",
  "invoices.issue",
  "invoices.cancel",
  "payments.record",
  "purchase.order.issue",
  "people.salary.view",
  "settings.company",
  "users.manage",
  "records.delete",
  "merge.execute",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = {
  gerant: [...PERMISSIONS],
  commercial: ["offers.margin.view", "offers.issue", "merge.execute"],
  achats: ["purchase.order.issue", "merge.execute"],
  chantier: [],
  compta: ["offers.margin.view", "invoices.issue", "payments.record", "people.salary.view"],
  lecture: [],
} as const satisfies Record<string, readonly Permission[]>;

export type Role = keyof typeof ROLES;

export function can(role: Role, permission: Permission): boolean {
  return (ROLES[role] as readonly Permission[]).includes(permission);
}

/**
 * LAW 6 — the assistant holds EXACTLY the caller's permissions. There is no
 * service account, no elevation, and no delete tool anywhere in its registry.
 */
export function assistantPermissions(role: Role): readonly Permission[] {
  return (ROLES[role] as readonly Permission[]).filter((p) => p !== "records.delete");
}

/**
 * A permission never hides that a thing exists (screen 79). The Margin column
 * stays listed and greyed; the list says how many rows are hidden and names the
 * permission. Use this rather than silently filtering.
 */
export type Redacted<T> = { visible: T[]; hiddenCount: number; hiddenBy: Permission | null };
