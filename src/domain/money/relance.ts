/**
 * Screen 20 — the relance policy.
 *
 * The screen states the contract in one line, and this file keeps it:
 *
 *   **"The policy fires the reminders; a person still approves anything that
 *   escalates."**
 *
 * So `dueNow()` computes WHAT IS OWED A CHASE. It sends nothing, drafts
 * nothing, and writes nothing. LAW 6, and the safety rail `NEVER_AUTO_REPLY`.
 * The day something in this system emails a client on its own will be a day
 * somebody decided to build that, on purpose, with their name on it.
 */

export const STEP_KEYS = [
  "reminder1",
  "reminder2",
  "phone",
  "mise_en_demeure",
  "stop_offers",
] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export type Step = {
  key: StepKey;
  /** Days after the DUE date, not after the previous step. */
  afterDueDays: number;
  channel: "email" | "phone" | "letter" | "block";
  needsApproval: boolean;
  position: number;
  enabled: boolean;
};

/**
 * The policy as screen 20 draws it, seeded so the settings screen has something
 * to edit rather than an empty table nobody knows how to fill.
 *
 * `mise_en_demeure` carries `needsApproval` and always will. It is a formal
 * notice under Algerian commercial practice and the first step towards court;
 * a system sending one to a client of fifteen years over a fortnight's delay
 * would cost more than the invoice it was chasing.
 *
 * `stop_offers` is `block` — it does not write to the client at all. It stops
 * US, by warning before a new offer goes out to somebody who has owed money for
 * four months. That is the step with teeth, and it is the quietest one.
 */
export const DEFAULT_POLICY: Step[] = [
  {
    key: "reminder1",
    afterDueDays: 7,
    channel: "email",
    needsApproval: false,
    position: 1,
    enabled: true,
  },
  {
    key: "reminder2",
    afterDueDays: 21,
    channel: "email",
    needsApproval: false,
    position: 2,
    enabled: true,
  },
  {
    key: "phone",
    afterDueDays: 35,
    channel: "phone",
    needsApproval: false,
    position: 3,
    enabled: true,
  },
  {
    key: "mise_en_demeure",
    afterDueDays: 60,
    channel: "letter",
    needsApproval: true,
    position: 4,
    enabled: true,
  },
  {
    key: "stop_offers",
    afterDueDays: 120,
    channel: "block",
    needsApproval: true,
    position: 5,
    enabled: true,
  },
];

export const RELANCE_STATUSES = ["draft", "sent", "delivered", "replied", "failed"] as const;
export type RelanceStatus = (typeof RELANCE_STATUSES)[number];

export type RelanceRecord = {
  id: string;
  stepKey: string | null;
  channel: string;
  status: RelanceStatus;
  sentAt: Date | null;
  promisedOn: Date | null;
};

export type DueStep = {
  step: Step;
  /** The day it became due. */
  dueSince: Date;
  daysLate: number;
  /** Nothing leaves without a person when this is true. */
  needsApproval: boolean;
  /** A draft already exists and is waiting for somebody. */
  drafted: boolean;
};

/**
 * What chase is due on this invoice right now, or null.
 *
 * ONE step, not a list of everything overdue. If an invoice is 128 days old and
 * nobody has chased it, three steps are technically "due" — and sending three
 * emails in a morning is how a client stops reading any of them. The next one
 * that has not been done is the one that is due.
 *
 * A step counts as DONE when a relance exists for it that is not a draft. A
 * draft is not a chase: screen 20 shows a mise en demeure prepared and "not
 * sent — awaiting your approval", and the client has heard nothing.
 */
export function dueNow(opts: {
  dueOn: Date | null;
  balance: string;
  policy: Step[];
  history: RelanceRecord[];
  today: Date;
}): DueStep | null {
  // Nothing to chase. Also covers a credit note or a written-off invoice, both
  // of which have no balance and should never generate a reminder.
  if (Number(opts.balance) <= 0) return null;
  // No due date, nothing to be late against. The same reasoning as `bucketOf`:
  // chasing somebody for missing a deadline nobody recorded is inventing one.
  if (!opts.dueOn) return null;

  // A promise the client made, that has not yet come round. Screen 20 shows
  // "Promised payment week of 11 Aug" — chasing again before that date is how
  // a business becomes the one nobody takes calls from.
  const promised = opts.history
    .map((h) => h.promisedOn)
    .filter((day): day is Date => day !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (promised && promised >= opts.today) return null;

  const done = new Set(
    opts.history.filter((h) => h.status !== "draft" && h.stepKey).map((h) => h.stepKey as string),
  );
  const drafts = new Set(
    opts.history.filter((h) => h.status === "draft" && h.stepKey).map((h) => h.stepKey as string),
  );

  const ordered = opts.policy.filter((s) => s.enabled).sort((a, b) => a.position - b.position);

  for (const step of ordered) {
    if (done.has(step.key)) continue;

    const dueSince = new Date(opts.dueOn.getTime() + step.afterDueDays * 86_400_000);
    if (dueSince > opts.today) return null; // Not yet, and nothing after it is either.

    return {
      step,
      dueSince,
      daysLate: Math.floor((opts.today.getTime() - dueSince.getTime()) / 86_400_000),
      needsApproval: step.needsApproval,
      drafted: drafts.has(step.key),
    };
  }

  // Every step has been done. The policy is exhausted; a person decides what
  // happens next, and the system stops proposing.
  return null;
}

/**
 * "Stop new offers" — the step with teeth, applied where it bites.
 *
 * Not a message to the client. A warning to US, before an offer goes out to
 * somebody who has owed money for four months. It is `block` rather than
 * `email` because that is exactly what it does, and calling it a reminder would
 * have hidden the one step that changes behaviour.
 *
 * It WARNS. It does not refuse: the Gérant may have very good reasons to quote
 * a client who is late, and a system that refuses on his behalf is a system he
 * works around. LAW 6.
 */
export function shouldWarnBeforeQuoting(opts: {
  owed: { dueOn: Date | null; balance: string }[];
  policy: Step[];
  today: Date;
}): { warn: boolean; oldestDays: number; total: string } {
  const step = opts.policy.find((s) => s.key === "stop_offers" && s.enabled);
  if (!step) return { warn: false, oldestDays: 0, total: "0" };

  let oldestDays = 0;
  let total = 0;

  for (const invoice of opts.owed) {
    if (!invoice.dueOn || Number(invoice.balance) <= 0) continue;
    const days = Math.floor((opts.today.getTime() - invoice.dueOn.getTime()) / 86_400_000);
    if (days < step.afterDueDays) continue;
    oldestDays = Math.max(oldestDays, days);
    total += Number(invoice.balance);
  }

  return { warn: oldestDays > 0, oldestDays, total: total.toFixed(2) };
}

/** Screen 20's "Send N relances" — everything due that needs no approval. */
export function readyToSend(
  invoices: { documentId: string; due: DueStep | null }[],
): { documentId: string; step: Step }[] {
  return invoices
    .filter((i) => i.due && !i.due.needsApproval && i.due.step.channel !== "block")
    .map((i) => ({ documentId: i.documentId, step: (i.due as DueStep).step }));
}

/** Everything due that a person must approve first. Counted apart, always. */
export function awaitingApproval(
  invoices: { documentId: string; due: DueStep | null }[],
): { documentId: string; step: Step }[] {
  return invoices
    .filter((i) => i.due?.needsApproval)
    .map((i) => ({ documentId: i.documentId, step: (i.due as DueStep).step }));
}
