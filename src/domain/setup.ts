import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { userRole } from "@/db/schema/auth";
import { bankAccount, COMPANY_ID, companyIdentity, vatRate } from "@/db/schema/company";
import { numberingSeries } from "@/db/schema/document";
import { intakeChannel } from "@/db/schema/intake";
import { blockingRule } from "@/db/schema/interface";
import { party, person } from "@/db/schema/party";

/**
 * Screen 85 — Day one.
 *
 * "Eleven things to set before the first document can be issued", and "until
 * the first four rows are done, no invoice can be issued at all."
 *
 * LAW 1 — every one of these eleven is COMPUTED. There is no `setup_progress`
 * table and no "step 3 complete" flag, because a stored flag is a flag that
 * survives somebody deleting the thing it was about. A step is done when the
 * thing it asks for exists, and the day it stops existing the step reopens.
 */

export const SETUP_STEPS = [
  "identity",
  "logo",
  "vat",
  "numbering",
  "bank",
  "stampDuty",
  "paymentTerms",
  "roles",
  "mailbox",
  "storage",
  "moveIn",
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/**
 * The first four. Nothing may be issued until all four are done — décret
 * 05-468 for the identity, and plain arithmetic for the other three.
 */
export const BLOCKING_STEPS: SetupStep[] = ["identity", "logo", "vat", "numbering"];

export type StepState = {
  key: SetupStep;
  done: boolean;
  /** Where the button goes. Null when the step is done. */
  href: string | null;
  /** connect | import | setUp — which of the three verbs screen 85 uses. */
  verb: "setUp" | "connect" | "import";
  blocking: boolean;
};

export type SetupState = {
  steps: StepState[];
  done: number;
  total: number;
  /** All four blocking steps are done. */
  canIssue: boolean;
  /** Which of the four are not, so the reason can be named rather than counted. */
  missing: SetupStep[];
};

/**
 * décret 05-468 requires all four on every invoice. Three of them present is
 * not "mostly compliant" — it is an invoice that cannot legally be issued.
 */
export function identityComplete(row: typeof companyIdentity.$inferSelect | undefined): boolean {
  if (!row) return false;
  return Boolean(row.legalName && row.address && row.rc && row.nif && row.nis && row.ai);
}

export async function setupState(): Promise<SetupState> {
  const [identity] = await db
    .select()
    .from(companyIdentity)
    .where(eq(companyIdentity.id, COMPANY_ID))
    .limit(1);

  const [rates] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(vatRate)
    .where(isNull(vatRate.endsOn));

  const [series] = await db.select({ n: sql<number>`count(*)::int` }).from(numberingSeries);

  const [banks] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bankAccount)
    .where(isNull(bankAccount.archivedAt));

  const [stampDuty] = await db
    .select({ confirmed: blockingRule.confirmedOn })
    .from(blockingRule)
    .where(eq(blockingRule.code, "invoice.stampDutyThreshold"))
    .limit(1);

  const [terms] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(party)
    .where(sql`${party.paymentTerms} is not null`);

  const [roles] = await db.select({ n: sql<number>`count(*)::int` }).from(userRole);

  const [mailbox] = await db
    .select({ status: intakeChannel.status })
    .from(intakeChannel)
    .where(eq(intakeChannel.key, "mailbox"))
    .limit(1);

  const [records] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(party)
    .where(isNull(party.deletedAt));

  const [people] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(person)
    .where(and(isNull(person.deletedAt)));

  const raw: Record<SetupStep, { done: boolean; href: string | null; verb: StepState["verb"] }> = {
    identity: { done: identityComplete(identity), href: "/setup/identity", verb: "setUp" },
    logo: { done: Boolean(identity?.logoPath), href: "/setup/identity", verb: "setUp" },
    vat: { done: (rates?.n ?? 0) > 0, href: "/setup/vat", verb: "setUp" },
    numbering: { done: (series?.n ?? 0) > 0, href: "/setup/numbering", verb: "setUp" },
    bank: { done: (banks?.n ?? 0) > 0, href: "/setup/bank", verb: "setUp" },
    // Not "a value is set" — a person confirmed the rule. It is one of the four
    // waiting on the accountant, and confirming it is what makes it a fact.
    stampDuty: { done: Boolean(stampDuty?.confirmed), href: "/settings/compliance", verb: "setUp" },
    paymentTerms: { done: (terms?.n ?? 0) > 0, href: "/companies", verb: "setUp" },
    // Everyone is Gérant until you say otherwise — so this is done when a
    // second role has been assigned, not when the first one has.
    roles: { done: (roles?.n ?? 0) > 1, href: "/settings/users", verb: "setUp" },
    mailbox: { done: mailbox?.status === "live", href: "/settings/channels", verb: "connect" },
    storage: { done: false, href: "/settings/storage", verb: "connect" },
    moveIn: {
      done: (records?.n ?? 0) > 0 || (people?.n ?? 0) > 0,
      href: "/settings/import",
      verb: "import",
    },
  };

  const steps: StepState[] = SETUP_STEPS.map((key) => ({
    key,
    done: raw[key].done,
    href: raw[key].done ? null : raw[key].href,
    verb: raw[key].verb,
    blocking: BLOCKING_STEPS.includes(key),
  }));

  const missing = BLOCKING_STEPS.filter((key) => !raw[key].done);

  return {
    steps,
    done: steps.filter((s) => s.done).length,
    total: steps.length,
    canIssue: missing.length === 0,
    missing,
  };
}

/**
 * The gate itself.
 *
 * Every document-issuing path calls this before allocating a number, because a
 * number allocated against an incomplete identity cannot be un-allocated —
 * LAW 5, and the reason screen 85 exists at all.
 */
export class CannotIssueYet extends Error {
  constructor(readonly missing: SetupStep[]) {
    super("setupIncomplete");
  }
}

export async function assertCanIssue(): Promise<void> {
  const state = await setupState();
  if (!state.canIssue) throw new CannotIssueYet(state.missing);
}
