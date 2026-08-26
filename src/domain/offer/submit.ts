/**
 * Screen 12 — "Before you submit".
 *
 * The sibling of screen 18's before-issuing checklist, and it draws the same
 * distinction that file draws between a RULE and a FACT:
 *
 *   A rule can block. "The client's NIF is missing" blocks because Algerian law
 *   requires it on the document, and issuing without it produces a paper the
 *   client's accountant will send back.
 *
 *   A fact never blocks. "Proof of submission — pending" is not a failure; it
 *   is a receipt that does not exist yet because the envelope has not been
 *   handed over. Marking it as a blocker would refuse to let somebody submit an
 *   offer until they had proof of having submitted it.
 *
 * Nothing here invents a requirement. Every blocker traces to something a
 * person or a decree actually said — see `src/domain/compliance-profile.ts`.
 */

export const SUBMIT_CHECKS = [
  "clientNif",
  "allLinesPriced",
  "allLinesCosted",
  "submissionMethod",
  "proofOfSubmission",
  "validityCoversDeadline",
] as const;
export type SubmitCheckKey = (typeof SUBMIT_CHECKS)[number];

/** `block` refuses; `warn` is worth reading; `note` is a fact, not a problem. */
export type CheckState = "pass" | "warn" | "block" | "note";

export type SubmitCheck = {
  key: SubmitCheckKey;
  state: CheckState;
  /** Extra values for the sentence the screen prints. */
  detail?: Record<string, string | number>;
  /** The route that fixes it, when one screen obviously does. */
  fixHref?: string;
};

export type SubmitFacts = {
  clientNif: string | null;
  clientId: string;
  /** Item lines only. */
  lines: { unitPrice: string | null; unitCost: string | null }[];
  submissionMethod: string;
  /** Set once somebody records that the envelope was handed over. */
  submittedAt: Date | null;
  proofRef: string | null;
  /** How long our offer stands, in days, as typed on the Terms tab. */
  validDays: number | null;
  /** What the client requires it to stand for. Null until confirmed. */
  requiredValidityDays: number | null;
};

export function submitChecks(facts: SubmitFacts): SubmitCheck[] {
  const out: SubmitCheck[] = [];

  // A RULE. Fifteen digits, on the document, because the client's accountant
  // will send back a paper without one.
  out.push(
    facts.clientNif && facts.clientNif.trim().length > 0
      ? { key: "clientNif", state: "pass" }
      : {
          key: "clientNif",
          state: "block",
          fixHref: `/companies/${facts.clientId}/edit`,
        },
  );

  const unpriced = facts.lines.filter((l) => l.unitPrice === null || Number(l.unitPrice) <= 0);
  out.push(
    unpriced.length === 0
      ? { key: "allLinesPriced", state: "pass" }
      : { key: "allLinesPriced", state: "block", detail: { n: unpriced.length } },
  );

  // A FACT, not a rule. An offer with no cost on a line can still go out — the
  // client never sees the cost column. What it cannot do is tell you truthfully
  // what you are making, so it is a warning and it says how many.
  const uncosted = facts.lines.filter((l) => l.unitCost === null);
  out.push(
    uncosted.length === 0
      ? { key: "allLinesCosted", state: "pass" }
      : { key: "allLinesCosted", state: "warn", detail: { n: uncosted.length } },
  );

  out.push(
    facts.submissionMethod && facts.submissionMethod !== "unknown"
      ? { key: "submissionMethod", state: "pass" }
      : { key: "submissionMethod", state: "block" },
  );

  /**
   * A FACT. "Pending" until the envelope is handed over, and blocking on it
   * would refuse to let somebody submit an offer until they had proof of
   * having submitted it.
   */
  out.push(
    facts.submittedAt
      ? facts.proofRef
        ? { key: "proofOfSubmission", state: "pass", detail: { ref: facts.proofRef } }
        : { key: "proofOfSubmission", state: "warn" }
      : { key: "proofOfSubmission", state: "note" },
  );

  /**
   * Our validity against the client's requirement — the same comparison screen
   * 67 makes against suppliers, pointed the other way. Silent when the client's
   * requirement has not been confirmed: no requirement, no conflict.
   */
  if (facts.requiredValidityDays !== null && facts.validDays !== null) {
    out.push(
      facts.validDays >= facts.requiredValidityDays
        ? { key: "validityCoversDeadline", state: "pass" }
        : {
            key: "validityCoversDeadline",
            state: "block",
            detail: {
              ours: facts.validDays,
              theirs: facts.requiredValidityDays,
              shortBy: facts.requiredValidityDays - facts.validDays,
            },
          },
    );
  }

  return out;
}

export function canSubmit(checks: SubmitCheck[]): boolean {
  return checks.every((check) => check.state !== "block");
}

export function countChecks(checks: SubmitCheck[]): { blockers: number; warnings: number } {
  return {
    blockers: checks.filter((c) => c.state === "block").length,
    warnings: checks.filter((c) => c.state === "warn").length,
  };
}
