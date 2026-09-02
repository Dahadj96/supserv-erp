/**
 * ONE choke point for permissions. Not scattered through components.
 *
 * There is no Supabase and therefore no RLS convenience layer, which is fine at
 * six users — but it means this file is the only thing standing between a user
 * and data they may not see. Every server action calls it. No exceptions.
 */
export const PERMISSIONS = [
  /**
   * Who may read the captured mailbox.
   *
   * Added 27 August 2026, the day the first real mail arrived. Until then the
   * Inbox had no permission at all: `listInbox` takes no user, and nothing in
   * this file mentioned it - so every signed-in account, `lecture` and
   * `chantier` included, could read every message sent to contact@.
   *
   * That was survivable while contact@ was the only channel, because it is the
   * address printed on the website. It stops being survivable the moment
   * recrutement@ (CVs, salary expectations) or commercial@ (prices, margins)
   * is connected - which is the plan. So the gate goes in first.
   *
   * Note what this is NOT: it is not "may read records". Records are curated
   * and permissioned individually. This is raw correspondence, unfiltered, spam
   * and CVs included, which is why `lecture` does not get it.
   */
  "inbox.view",
  "offers.margin.view",
  "offers.issue",
  "invoices.issue",
  "invoices.cancel",
  "payments.record",
  "purchase.order.issue",
  /**
   * The four below were added on 2 September 2026, when the first end-to-end
   * walk found that `ISSUE_PERMISSION` named six of the nineteen document
   * kinds. The other thirteen — a devis, a bon de livraison, the client's own
   * order — were refused to everybody, the Gérant included: `mayIssue` treats
   * an unlisted kind as "nobody decided", which is right, and nobody had.
   */
  "deliveries.issue",
  "works.issue",
  "purchase.invoice.record",
  "letters.issue",
  "people.salary.view",
  "settings.company",
  "users.manage",
  "records.delete",
  "merge.execute",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * `inbox.view` goes to the four roles whose work arrives by email: enquiries
 * and tender invitations to commercial, supplier quotes to achats, invoices and
 * payment advices to compta, all of it to the Gérant.
 *
 * Not `chantier` and not `lecture`. Site staff have no reason to read the
 * company's correspondence, and read-only means read-only over RECORDS - a
 * mailbox is not a record, it is everything anybody has ever sent us including
 * the spam.
 */
export const ROLES = {
  gerant: [...PERMISSIONS],
  commercial: [
    "inbox.view",
    "offers.margin.view",
    "offers.issue",
    "deliveries.issue",
    "works.issue",
    "letters.issue",
    "merge.execute",
  ],
  achats: [
    "inbox.view",
    "purchase.order.issue",
    "purchase.invoice.record",
    "deliveries.issue",
    "merge.execute",
  ],
  // Site staff hand goods over and sign work off. That is the whole of it.
  chantier: ["deliveries.issue", "works.issue"],
  compta: [
    "inbox.view",
    "offers.margin.view",
    "invoices.issue",
    "payments.record",
    "purchase.invoice.record",
    "letters.issue",
    "people.salary.view",
  ],
  lecture: [],
} as const satisfies Record<string, readonly Permission[]>;

export type Role = keyof typeof ROLES;

/** No role — a session whose user was never given one — may do nothing. */
export function can(role: Role | null, permission: Permission): boolean {
  if (!role) return false;
  return (ROLES[role] as readonly Permission[]).includes(permission);
}

/** Any one of several — a price can be captured by whoever quotes or buys. */
export function canAny(role: Role | null, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => can(role, permission));
}

/**
 * May this role change anything at all?
 *
 * `lecture` is read-only and that has to mean something concrete: no note, no
 * contact, no line pasted into an enquiry. The actions that carry no specific
 * permission — adding a person, saving a technical requirement — ask this
 * instead of nothing, so read-only is enforced by the server and not by which
 * buttons a page happens to draw.
 */
export function canWrite(role: Role | null): boolean {
  return role !== null && role !== "lecture";
}

/**
 * Which permission it takes to issue each kind of document.
 *
 * Deliberately exhaustive rather than defaulted. A kind nobody has thought about
 * must not fall through to `invoices.issue` and quietly let a Commercial issue
 * it — an unknown kind is refused until somebody decides who owns it.
 */
export const ISSUE_PERMISSION: Record<string, Permission> = {
  // What we send a client to win the work, and their answer.
  quotation: "offers.issue",
  proforma: "offers.issue",
  offer: "offers.issue",
  client_order: "offers.issue",
  // What leaves the warehouse and what is signed off on site.
  delivery_note: "deliveries.issue",
  work_order: "works.issue",
  service_report: "works.issue",
  reception_report: "works.issue",
  // What the client owes us.
  invoice: "invoices.issue",
  advance_invoice: "invoices.issue",
  situation: "invoices.issue",
  credit_note: "invoices.issue",
  statement: "invoices.issue",
  // What we buy.
  purchase_order: "purchase.order.issue",
  comparison_sheet: "purchase.order.issue",
  goods_receipt: "purchase.order.issue",
  supplier_invoice: "purchase.invoice.record",
  // Letters on the letterhead.
  attestation: "letters.issue",
  official_letter: "letters.issue",
  cover_letter: "letters.issue",
};

export function mayIssue(role: Role | null, kind: string): boolean {
  const needed = ISSUE_PERMISSION[kind];
  if (!needed || !role) return false;
  return can(role, needed);
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
