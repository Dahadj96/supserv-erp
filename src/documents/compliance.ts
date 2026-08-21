import { eq } from "drizzle-orm";
import { db } from "@/db";
import type { companyIdentity } from "@/db/schema/company";
import { blockingRule } from "@/db/schema/interface";
import type { party } from "@/db/schema/party";

/**
 * Screen 70 — "Applies the compliance profile: blocks if a CONFIRMED rule
 * fails."
 *
 * That one word is the whole design. Screen 85 lists four rules waiting on the
 * accountant, and until somebody confirms one it warns and lets you proceed.
 * The moment it is confirmed, the same rule refuses. Nothing here decides on
 * its own authority which laws apply — a person did that, and their name and
 * the date are on the row.
 */

export type Finding = {
  code: string;
  /**
   * pass  — the rule was evaluated and the document satisfies it
   * warn  — it fails, but nobody has confirmed the rule, so it does not block
   * block — it fails and a person has confirmed the rule
   *
   * Screen 18 lists all three. A checklist that only showed failures would let
   * somebody believe the other nine things were never checked — and "we did
   * look at your NIS" is the reassurance the screen exists to give.
   */
  severity: "pass" | "warn" | "block";
  authority: string | null;
  confirmedBy: string | null;
  confirmedOn: string | null;
  fixRoute: string | null;
};

export type CheckSubject = {
  kind: string;
  company: typeof companyIdentity.$inferSelect | null;
  counterparty: typeof party.$inferSelect | null;
  /** DZD. Used by the rules that have a threshold. */
  total: number;
  settlementInCash: boolean;
};

/**
 * The checks themselves.
 *
 * Each returns true when the rule FAILS. Whether a failure blocks or merely
 * warns is decided by `blocking_rule.confirmed_on`, not here — this file knows
 * facts about a document, never about which laws are in force.
 */
const CHECKS: Record<string, (s: CheckSubject) => boolean> = {
  // décret 05-468 — the four identifiers, on our side and theirs.
  "invoice.companyIdentityIncomplete": (s) =>
    !s.company?.rc || !s.company?.nif || !s.company?.nis || !s.company?.ai,
  "invoice.clientNifMissing": (s) => !s.counterparty?.nif,

  // The four waiting on the accountant. They are written down, they warn, and
  // the day somebody confirms them they start refusing.
  "invoice.stampDutyThreshold": (s) => s.settlementInCash && s.total > 0,
  "invoice.retentionTreatment": () => false,
  "invoice.vatServicesAbroad": () => false,
  "proforma.validityPeriod": (s) => s.kind === "proforma",
};

export async function check(subject: CheckSubject): Promise<Finding[]> {
  const rules = await db.select().from(blockingRule);
  const findings: Finding[] = [];

  for (const rule of rules) {
    if (!rule.appliesTo.startsWith(subject.kind) && !rule.code.startsWith(subject.kind)) continue;

    const test = CHECKS[rule.code];
    if (!test) continue;

    const fails = test(subject);

    findings.push({
      code: rule.code,
      // Passing is reported too — screen 18 lists ten checks and only one of
      // them is red. Confirmed by a person and failing → it blocks. Not yet
      // confirmed → it warns and lets you proceed, which is screen 85's
      // promise and screen 69's job to change.
      severity: !fails ? "pass" : rule.confirmedOn ? "block" : "warn",
      authority: rule.authority,
      confirmedBy: rule.confirmedBy,
      confirmedOn: rule.confirmedOn,
      fixRoute: rule.fixRoute,
    });
  }

  return findings;
}

export class Blocked extends Error {
  constructor(readonly findings: Finding[]) {
    super("complianceBlocked");
  }
}

/**
 * The four rules from screen 85, written down so they exist before anybody
 * confirms them. A rule nobody has written down cannot be confirmed, and a
 * system that invents the rule at the moment it needs it is a system asserting
 * a law on its own authority.
 */
export const ACCOUNTANT_RULES = [
  {
    code: "invoice.stampDutyThreshold",
    appliesTo: "invoice.issue",
    messageKey: "rules.invoice.stampDutyThreshold",
    authority: "code du timbre",
    fixRoute: "/settings/compliance",
  },
  {
    code: "invoice.retentionTreatment",
    appliesTo: "invoice.issue",
    messageKey: "rules.invoice.retentionTreatment",
    authority: "company policy",
    fixRoute: "/settings/compliance",
  },
  {
    code: "invoice.vatServicesAbroad",
    appliesTo: "invoice.issue",
    messageKey: "rules.invoice.vatServicesAbroad",
    authority: "code des taxes sur le chiffre d'affaires",
    fixRoute: "/settings/compliance",
  },
  {
    code: "proforma.validityPeriod",
    appliesTo: "proforma.issue",
    messageKey: "rules.proforma.validityPeriod",
    authority: "company policy",
    fixRoute: "/settings/compliance",
  },
] as const;

/** décret 05-468. Not waiting on anybody — it is confirmed by the decree itself. */
export const DECREE_RULES = [
  {
    code: "invoice.companyIdentityIncomplete",
    appliesTo: "invoice.issue",
    messageKey: "rules.invoice.companyIdentityIncomplete",
    authority: "décret exécutif 05-468",
    fixRoute: "/setup/identity",
    confirmedBy: "décret exécutif 05-468",
    confirmedOn: "2005-12-10",
  },
  {
    code: "invoice.clientNifMissing",
    appliesTo: "invoice.issue",
    messageKey: "rules.invoice.clientNifMissing",
    authority: "décret exécutif 05-468",
    fixRoute: "/companies",
    confirmedBy: "décret exécutif 05-468",
    confirmedOn: "2005-12-10",
  },
] as const;

export async function ensureRulesExist() {
  for (const rule of DECREE_RULES) {
    await db
      .insert(blockingRule)
      .values({ ...rule })
      .onConflictDoNothing();
  }
  for (const rule of ACCOUNTANT_RULES) {
    await db
      .insert(blockingRule)
      .values({ ...rule, confirmedBy: null, confirmedOn: null })
      .onConflictDoNothing();
  }
}

/** Screen 69 — a person, with a name and a date, turns a warning into a block. */
export async function confirmRule(code: string, who: string, on = new Date()) {
  await db
    .update(blockingRule)
    .set({ confirmedBy: who, confirmedOn: on.toISOString().slice(0, 10) })
    .where(eq(blockingRule.code, code));
}
