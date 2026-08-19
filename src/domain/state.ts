/**
 * LAW 1 — store a state only when a person or an event changes it. Compute it
 * when time or arithmetic changes it.
 *
 * Two bugs were found in the Figma file by exactly this rule: "won" was stored on
 * two entities, and "overdue" was an invoice status. Both are fixed here.
 */

export const INVOICE_STATES = [
  "draft", "issued", "part_paid", "paid", "credited", "written_off",
] as const;
export type InvoiceState = (typeof INVOICE_STATES)[number];

/** NOT a state. Nothing transitions an invoice to overdue — a date passes. */
export function isOverdue(dueOn: Date | null, balanceValue: string, today = new Date()): boolean {
  if (!dueOn) return false;
  return dueOn < today && Number(balanceValue) > 0;
}

export function daysOverdue(dueOn: Date | null, today = new Date()): number {
  if (!dueOn || dueOn >= today) return 0;
  return Math.floor((today.getTime() - dueOn.getTime()) / 86_400_000);
}

const INVOICE_TRANSITIONS: Record<InvoiceState, InvoiceState[]> = {
  draft: ["issued"],
  issued: ["part_paid", "paid", "credited", "written_off"],
  part_paid: ["paid", "credited", "written_off"],
  paid: ["credited"],
  credited: [],
  written_off: [],
};

export function canTransition(from: InvoiceState, to: InvoiceState): boolean {
  return INVOICE_TRANSITIONS[from].includes(to);
}

export const OFFER_STATES = ["draft", "sent", "accepted", "rejected", "expired"] as const;
export type OfferState = (typeof OFFER_STATES)[number];

/**
 * A deal is not won. Its OFFER is accepted, and the deal reads that. One fact,
 * one owner — otherwise the two drift and nobody knows which is true.
 */
export function dealOutcome(offerStates: OfferState[]): "won" | "lost" | "open" {
  if (offerStates.includes("accepted")) return "won";
  if (offerStates.length > 0 && offerStates.every((s) => s === "rejected" || s === "expired")) {
    return "lost";
  }
  return "open";
}
