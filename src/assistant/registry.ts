import { assistantPermissions, can, type Permission, type Role } from "@/auth/can";

/**
 * Screens 43, 44, 45 — everything the assistant can do, in one list.
 *
 * LAW 6: the assistant proposes, never executes. That sentence is only worth
 * anything if there is a place you can go to check it, so this is that place —
 * and it is the list the runtime actually uses, not a description of it.
 *
 * Three kinds, and the third is the point:
 *
 *   read     answers a question from data. Changes nothing.
 *   propose  writes a PROPOSAL. Still changes nothing about the business — a
 *            proposal is a row saying "somebody might want to do this".
 *   never    named, and not implemented anywhere. See NEVER below.
 *
 * There is no fourth kind. Nothing in this registry writes to a business table,
 * and `tests/unit/assistant-registry.test.ts` reads the source of every handler
 * to check that stays true.
 */

export type ToolKind = "read" | "propose";

export type Tool = {
  name: string;
  kind: ToolKind;
  /**
   * The permission the CALLER must hold. Null means anybody signed in.
   *
   * The assistant has no permissions of its own — `assistantPermissions` gives
   * it exactly the caller's, minus `records.delete`. There is no service
   * account and no elevation, so a Commercial asking the assistant about
   * margins gets whatever a Commercial would get by opening the screen.
   */
  permission: Permission | null;
  /**
   * Where its answer points. Every reading the assistant reports has to be
   * checkable on a screen a person can open — an answer you cannot verify is a
   * rumour with a citation-shaped hole in it.
   */
  cites: string;
};

export const TOOLS: Tool[] = [
  {
    name: "whatIsLate",
    kind: "read",
    permission: null,
    cites: "/today",
  },
  {
    name: "whyIsItLate",
    kind: "read",
    permission: null,
    cites: "/today",
  },
  {
    name: "whatIsWaitingOnThem",
    kind: "read",
    permission: null,
    cites: "/waiting-on",
  },
  {
    name: "whatWouldBeRefused",
    kind: "read",
    permission: null,
    cites: "/compliance",
  },
  {
    name: "whoOwesUs",
    kind: "read",
    permission: "invoices.issue",
    cites: "/payments/ageing",
  },
  {
    name: "draftRelance",
    kind: "propose",
    permission: "invoices.issue",
    cites: "/assistant/proposals",
  },
  {
    name: "draftEnquiryReply",
    kind: "propose",
    permission: "inbox.view",
    cites: "/assistant/proposals",
  },
];

/**
 * Named so they can be shown, and implemented nowhere.
 *
 * A list of refusals is only credible if it is specific. "The assistant is
 * safe" is marketing; "there is no tool that issues a document, and here is the
 * test that fails if one appears" is a claim somebody can check.
 *
 * `issue` and `send` are absent because they are irreversible outside this
 * building: a number is consumed, or a client reads something. `delete` is
 * absent because `assistantPermissions` strips `records.delete` before the
 * registry is even consulted — two locks, on purpose.
 */
export const NEVER = [
  "issueDocument",
  "sendEmail",
  "recordPayment",
  "deleteAnything",
  "changePermissions",
  "confirmComplianceRule",
] as const;

export function toolsFor(role: Role | null): Tool[] {
  if (!role) return [];
  const held = new Set<Permission>(assistantPermissions(role));
  return TOOLS.filter((tool) => tool.permission === null || held.has(tool.permission));
}

/**
 * Whether this caller may run this tool, answered the same way the screens
 * answer it. Not a second opinion — `can` is the only permission function in
 * the system and this defers to it.
 */
export function mayRun(role: Role | null, name: string): boolean {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool || !role) return false;
  if (tool.permission === null) return true;
  // `records.delete` is stripped for the assistant even from a Gérant, so the
  // check goes through `assistantPermissions` rather than straight to `can`.
  if (!assistantPermissions(role).includes(tool.permission)) return false;
  return can(role, tool.permission);
}
