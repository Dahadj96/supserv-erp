/**
 * Screen 05 — "stage is computed from the documents, outcome is read from the
 * offer". The chip row is labelled `STAGE — derived`.
 *
 * So `deal` has no stage column, and this file is the reason it does not need
 * one. Everything below is a pure function of things that already exist: a
 * decision somebody recorded, and documents that were issued or received.
 *
 * Why this is worth the trouble, given a `stage` column would obviously be
 * easier: a stored stage is a second opinion. The day an offer is issued and
 * the column still says "sourcing" — because somebody issued it from a screen
 * that forgot to update it, or a job died halfway — the list is lying, and
 * nobody can tell which of the two is right. A derived stage cannot drift from
 * the documents because it IS the documents.
 *
 * The cost is real and worth naming: this needs counts, so the list query has
 * to fetch them. That is a join, not a fiction.
 */

/** The six chips across the top of screen 05, in the order they are drawn. */
export const STAGES = ["new", "qualifying", "sourcing", "offerOut", "ordered", "invoiced"] as const;
export type Stage = (typeof STAGES)[number];

/**
 * How it ended. Separate from stage, because they answer different questions
 * and screen 05 shows them in the same column: a deal can be at `ordered` AND
 * `won`, and the badge prints the outcome because that is the more useful fact.
 */
export const OUTCOMES = ["won", "lost", "noBid"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export function isStage(value: string | undefined): value is Stage {
  return STAGES.includes((value ?? "") as Stage);
}

/**
 * Everything the stage is allowed to depend on. All of it lives in other
 * tables; none of it lives on `deal` except the two decisions a person makes.
 */
export type DealFacts = {
  /** null = nobody has looked at it yet. */
  decision: "pursue" | "no_bid" | null;
  /** Set only when a person records that we lost. Unknowable from documents. */
  lostAt: Date | null;
  /** Lines the client asked for. */
  lineCount: number;
  /** Suppliers we have actually asked — sourcing requests sent, not drafted. */
  suppliersAsked: number;
  /** Offers ISSUED. A draft offer is not an offer out; LAW 5 draws that line. */
  offersIssued: number;
  /** Client purchase orders received against this enquiry. */
  ordersReceived: number;
  /** Invoices issued against it. */
  invoicesIssued: number;
};

/**
 * How far along it got.
 *
 * Read from the furthest thing that exists and stop. A no-bid enquiry still has
 * a stage — it got as far as qualifying and then somebody said no — and that is
 * deliberate: "recorded so we can learn from it" only works if you can still
 * see what you walked away from.
 */
export function stageOf(facts: DealFacts): Stage {
  if (facts.invoicesIssued > 0) return "invoiced";
  if (facts.ordersReceived > 0) return "ordered";
  if (facts.offersIssued > 0) return "offerOut";
  if (facts.suppliersAsked > 0) return "sourcing";
  // A decision, or somebody having typed in what the client asked for, is the
  // difference between "this arrived" and "somebody is working on it".
  if (facts.decision !== null || facts.lineCount > 0) return "qualifying";
  return "new";
}

/**
 * How it ended, or null if it has not.
 *
 * `won` has no column and never will. Winning is an order arriving, and an
 * order is a document — a boolean somebody has to remember to tick is a boolean
 * that will be wrong.
 *
 * `lost` and `noBid` are the two that genuinely cannot be derived. Nothing in
 * this system records that a competitor was cheaper; the client says so on the
 * telephone, and somebody types it in.
 */
export function outcomeOf(facts: DealFacts): Outcome | null {
  if (facts.lostAt) return "lost";
  if (facts.decision === "no_bid") return "noBid";
  if (facts.ordersReceived > 0) return "won";
  return null;
}

/** What screen 05's badge column prints: the outcome if there is one, else the stage. */
export function badgeOf(facts: DealFacts): Stage | Outcome {
  return outcomeOf(facts) ?? stageOf(facts);
}

/**
 * Is this enquiry still live?
 *
 * Screen 05's header counts "23 open" and its deadline column prints `closed`
 * instead of a date for the rest. Won is closed too — the enquiry is finished
 * even though the work is not, and the work has its own screens.
 */
export function isOpen(facts: DealFacts): boolean {
  return outcomeOf(facts) === null;
}

/**
 * The deadline as the list shows it.
 *
 * A closed enquiry's deadline is not late, not urgent, and not interesting —
 * printing "3 days overdue" against a deal we walked away from in June is how a
 * list trains people to ignore red.
 */
export function deadlineDisplay(
  facts: DealFacts,
  deadlineAt: Date | null,
  now: Date,
): { kind: "closed" | "none" | "at"; at: Date | null; hoursLeft: number | null } {
  if (!isOpen(facts)) return { kind: "closed", at: null, hoursLeft: null };
  if (!deadlineAt) return { kind: "none", at: null, hoursLeft: null };
  const hoursLeft = Math.floor((deadlineAt.getTime() - now.getTime()) / 3_600_000);
  return { kind: "at", at: deadlineAt, hoursLeft };
}

/** Screen 05 colours the deadline red inside this many hours. Same number the
 *  inbox uses for the same reason — one idea of "soon" across the system. */
export const DEADLINE_WARNING_HOURS = 48;
