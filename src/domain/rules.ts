import type { InferSelectModel } from "drizzle-orm";
import type { blockingRule } from "@/db/schema/interface";

/**
 * Screen 80 — no grey button without a reason.
 *
 * If the system knows enough to disable a control, it knows enough to say why.
 * Every disabled control in the app resolves through here, and the popover shows
 * the message, names the authority, and offers a route to the fix.
 */

export type Rule = InferSelectModel<typeof blockingRule>;

export type RuleResult = {
  code: string;
  messageKey: string;
  authority: string | null;
  fixRoute: string | null;
  /** An unconfirmed rule WARNS. It never blocks. Screen 69. */
  severity: "block" | "warn";
};

export function evaluate(rules: Rule[], failedCodes: string[]): RuleResult[] {
  return rules
    .filter((r) => failedCodes.includes(r.code))
    .map((r) => ({
      code: r.code,
      messageKey: r.messageKey,
      authority: r.authority,
      fixRoute: r.fixRoute,
      severity: r.confirmedBy ? ("block" as const) : ("warn" as const),
    }));
}

export function isBlocked(results: RuleResult[]): boolean {
  return results.some((r) => r.severity === "block");
}

/**
 * The seed set. Four of these are unconfirmed and waiting on the accountant —
 * they warn today and become blocks the day somebody signs off on them.
 */
export const SEED_RULES: Omit<Rule, never>[] = [
  {
    code: "invoice.client_nif_missing",
    appliesTo: "invoice.issue",
    messageKey: "rules.invoice.clientNifMissing",
    authority: "décret 05-468",
    confirmedBy: "A. Dahadj",
    confirmedOn: "2026-08-01",
    fixRoute: "/companies/{partyId}#nif",
  },
  {
    code: "invoice.company_identity_incomplete",
    appliesTo: "invoice.issue",
    messageKey: "rules.invoice.companyIdentityIncomplete",
    authority: "décret 05-468",
    confirmedBy: "A. Dahadj",
    confirmedOn: "2026-08-01",
    fixRoute: "/settings/company",
  },
  {
    code: "invoice.no_delivery_note",
    appliesTo: "invoice.issue",
    messageKey: "rules.invoice.noDeliveryNote",
    authority: "company policy",
    confirmedBy: "A. Dahadj",
    confirmedOn: "2026-08-01",
    fixRoute: "/deliveries/new?invoice={documentId}",
  },
  {
    code: "offer.technical_annex_incomplete",
    appliesTo: "offer.send",
    messageKey: "rules.offer.annexIncomplete",
    authority: "client requirement",
    confirmedBy: "A. Dahadj",
    confirmedOn: "2026-08-01",
    fixRoute: "/deals/{dealId}/technical",
  },
  // ---- waiting on the accountant. These WARN.
  {
    code: "invoice.stamp_duty_threshold",
    appliesTo: "invoice.issue",
    messageKey: "rules.invoice.stampDutyThreshold",
    authority: "code du timbre",
    confirmedBy: null,
    confirmedOn: null,
    fixRoute: "/settings/compliance",
  },
  {
    code: "invoice.retention_treatment",
    appliesTo: "invoice.issue",
    messageKey: "rules.invoice.retentionTreatment",
    authority: "marchés publics",
    confirmedBy: null,
    confirmedOn: null,
    fixRoute: "/settings/compliance",
  },
  {
    code: "invoice.vat_services_abroad",
    appliesTo: "invoice.issue",
    messageKey: "rules.invoice.vatServicesAbroad",
    authority: "code des taxes",
    confirmedBy: null,
    confirmedOn: null,
    fixRoute: "/settings/compliance",
  },
  {
    code: "proforma.validity_period",
    appliesTo: "proforma.issue",
    messageKey: "rules.proforma.validityPeriod",
    authority: "usage commercial",
    confirmedBy: null,
    confirmedOn: null,
    fixRoute: "/settings/compliance",
  },
];
