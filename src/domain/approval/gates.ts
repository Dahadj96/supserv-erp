/**
 * Screen 65 — the nine gates.
 *
 *   "The audit log records what happened. These rules stop it happening until
 *    someone with the authority agrees. Different jobs — the system needs both."
 *
 * A gate is not a warning. Screen 65 is explicit — "the action is: blocked, not
 * warned" — and the difference matters more than it sounds: a warning is a
 * thing people learn to click past, and a system full of warnings nobody reads
 * is indistinguishable from a system with no rules at all.
 *
 * WHAT MAKES THIS WORTH BUILDING FOR A ONE-MAN COMPANY. The frame answers its
 * own obvious objection, and the answer is the reason self-approval is allowed:
 *
 *   "If you are the Gérant and the Commercial at once, these gates cost you a
 *    click each. Keep them anyway. The value is not the second person — it is
 *    that six months later the audit log says why the margin was 11.4% on that
 *    job, and you are not reconstructing it from memory."
 *
 * So a gate never refuses because the same person is on both sides. It refuses
 * until somebody with the authority has said yes IN WRITING, with a reason, and
 * that is worth a click even when the writer and the reader are the same man.
 */

export const GATE_CODES = [
  "offer.marginBelowFloor",
  "offer.discountAbove",
  "sourcing.notCheapest",
  "offer.termsBeyond",
  "deal.noBidAbove",
  "client.blockedForDebt",
  "document.creditNote",
  "invoice.writeOff",
  "document.changeIssued",
] as const;
export type GateCode = (typeof GATE_CODES)[number];

export type Gate = {
  code: GateCode;
  /** Who may decide. A role, never a person — people leave. */
  role: string;
  /** The number it fires at, when it is a number. */
  threshold: number | null;
  requiresReasonCode: boolean;
  requiresJustification: boolean;
  enabled: boolean;
  position: number;
};

/**
 * The defaults, seeded on first read so screen 65's Rules tab has something to
 * edit.
 *
 * `document.changeIssued` is here and is DIFFERENT from the other eight: it is
 * the one the frame marks "Nobody — not possible". It is listed because a
 * reader asking "what is gated" deserves the whole answer, and it is not
 * approvable by anyone because LAW 5 is structural — an issued document is
 * immutable, a correction is a credit note, and there is no code path that
 * edits one. A gate that could be approved would imply there is.
 */
export const DEFAULT_GATES: Gate[] = [
  {
    code: "offer.marginBelowFloor",
    role: "gerant",
    threshold: 15,
    requiresReasonCode: true,
    requiresJustification: true,
    enabled: true,
    position: 1,
  },
  {
    code: "offer.discountAbove",
    role: "gerant",
    threshold: 8,
    requiresReasonCode: true,
    requiresJustification: true,
    enabled: true,
    position: 2,
  },
  {
    code: "sourcing.notCheapest",
    role: "gerant",
    threshold: null,
    requiresReasonCode: true,
    requiresJustification: true,
    enabled: true,
    position: 3,
  },
  {
    code: "offer.termsBeyond",
    role: "gerant",
    threshold: 60,
    requiresReasonCode: true,
    requiresJustification: true,
    enabled: true,
    position: 4,
  },
  {
    code: "deal.noBidAbove",
    role: "gerant",
    threshold: 1_000_000,
    requiresReasonCode: true,
    requiresJustification: true,
    enabled: true,
    position: 5,
  },
  {
    code: "client.blockedForDebt",
    role: "gerant",
    threshold: null,
    requiresReasonCode: true,
    requiresJustification: true,
    enabled: true,
    position: 6,
  },
  {
    code: "document.creditNote",
    role: "gerant",
    threshold: null,
    requiresReasonCode: true,
    requiresJustification: true,
    enabled: true,
    position: 7,
  },
  {
    code: "invoice.writeOff",
    role: "gerant",
    threshold: null,
    requiresReasonCode: true,
    requiresJustification: true,
    enabled: true,
    position: 8,
  },
  // Nobody, ever. See the note above.
  {
    code: "document.changeIssued",
    role: "nobody",
    threshold: null,
    requiresReasonCode: false,
    requiresJustification: false,
    enabled: true,
    position: 9,
  },
];

/** The one nobody can approve. Not a permission — a fact about the code. */
export function isImpossible(gate: Pick<Gate, "role">): boolean {
  return gate.role === "nobody";
}

export const REQUEST_STATUSES = ["waiting", "approved", "declined", "withdrawn"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export type ApprovalRequest = {
  id: string;
  gateCode: GateCode;
  entity: string;
  entityId: string;
  subject: string;
  before: Record<string, string | null> | null;
  after: Record<string, string | null> | null;
  reasonCode: string | null;
  justification: string | null;
  requestedBy: string;
  requestedAt: Date;
  status: RequestStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  selfApproved: boolean;
};

export type Refusal =
  | "gateNotFound"
  | "gateDisabled"
  | "notApprovable"
  | "reasonCodeRequired"
  | "justificationRequired"
  | "notYourDecision"
  | "alreadyDecided";

/** May this request be made at all, and is it complete enough to be useful? */
export function checkRequest(opts: {
  gate: Gate | undefined;
  reasonCode: string | null;
  justification: string | null;
}): Refusal | null {
  if (!opts.gate) return "gateNotFound";
  if (!opts.gate.enabled) return "gateDisabled";
  // Asking for permission to edit an issued document is asking for something
  // no code path can do. Refusing at the request rather than at the decision
  // means nobody waits a day for an answer that was never possible.
  if (isImpossible(opts.gate)) return "notApprovable";

  if (opts.gate.requiresReasonCode && !opts.reasonCode?.trim()) return "reasonCodeRequired";
  // The sentence in somebody's own words is the entire point six months later.
  // A reason code alone reads "match a competitor" and answers nothing.
  if (opts.gate.requiresJustification && !opts.justification?.trim()) {
    return "justificationRequired";
  }
  return null;
}

/** May this person decide it? */
export function checkDecision(opts: {
  gate: Gate | undefined;
  request: Pick<ApprovalRequest, "status">;
  role: string | null;
}): Refusal | null {
  if (!opts.gate) return "gateNotFound";
  if (isImpossible(opts.gate)) return "notApprovable";
  if (opts.request.status !== "waiting") return "alreadyDecided";
  if (opts.role !== opts.gate.role) return "notYourDecision";
  return null;
}

/**
 * Deciding your own request. Allowed, and always recorded as such.
 *
 * Not a loophole to close later. In this company the Gérant IS the Commercial
 * most days, and a gate that refused would be a gate somebody routes around —
 * by not asking, which loses the record entirely. Recording it keeps the
 * sentence, which is what the gate was for.
 */
export function isSelfApproval(request: Pick<ApprovalRequest, "requestedBy">, decider: string) {
  return request.requestedBy === decider;
}

/** Screen 65's "How a gate behaves" card — the same seven answers every time. */
export const BEHAVIOUR = {
  theAction: "blockedNotWarned",
  theDraft: "savedAndKept",
  reasonCode: "required",
  justification: "required",
  approverSees: "beforeAndAfter",
  decision: "timestampedAndAttributed",
  ifDeclined: "draftStaysNothingLost",
} as const;

export type Waiting = {
  requests: ApprovalRequest[];
  /** How many this person may actually decide. */
  mine: number;
};

/**
 * What is waiting, and how much of it is this person's to answer.
 *
 * Everything waiting is SHOWN, whoever is looking — a Commercial should be able
 * to see that their own request is sitting there, and how long it has sat. Only
 * the buttons are gated. Hiding the row would leave somebody wondering whether
 * they ever asked.
 */
export function waitingFor(
  requests: ApprovalRequest[],
  gates: Gate[],
  role: string | null,
): Waiting {
  const waiting = requests.filter((row) => row.status === "waiting");
  return {
    requests: waiting.sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime()),
    mine: waiting.filter((row) => gates.find((g) => g.code === row.gateCode)?.role === role).length,
  };
}
