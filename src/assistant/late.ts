import { gather, missedDeadlines } from "@/domain/today/gather";
import { hoursLeft, type Item, type ItemKind } from "@/domain/today/list";

/**
 * "What is late, and why?" — the question PLAN §7 makes phase 7's acceptance
 * test, answered with citations.
 *
 * No language model is involved, and that is a decision rather than a shortcut:
 * docs/DECISIONS/2026-08-28-the-assistant-does-not-guess.md. Lateness is a fact
 * about a date and a balance. A model asked to compute it would sometimes be
 * right, always be unverifiable, and would have to be shown the company's
 * correspondence to do a job that arithmetic does exactly.
 *
 * `gather()` already produces every fact the Today screen stands on, and every
 * item carries an `href`. So the citation is not bolted on afterwards — it is
 * the same link the screen uses, which means a person can always go and look at
 * the row the answer came from.
 *
 * The difference from Today: Today never even fetches a deadline that has
 * passed, because "a deadline that expired yesterday is not urgent, it is
 * finished, and putting it at the top of the day with a black button is
 * cruelty". This function wants exactly the set Today refuses, so it asks for
 * it separately — `missedDeadlines()` — rather than loosening the query Today
 * depends on. Writing this test is what found that: "what is late" built on
 * `gather()` alone could never see a missed tender, which is the first thing
 * anybody asking the question means.
 */

/** Why a thing is late, as a reason the caller can render and check. */
export type Lateness =
  /** A deadline that has passed. `by` is hours since. */
  | { reason: "deadlinePassed"; hours: number }
  /** A deadline inside the warning window. `in` is hours remaining. */
  | { reason: "deadlineImminent"; hours: number }
  /** An invoice past its due date. */
  | { reason: "pastDue" }
  /** Work delivered and not yet billed. */
  | { reason: "notBilled" }
  /** A message nobody has answered. */
  | { reason: "unanswered" };

export type LateThing = {
  id: string;
  kind: ItemKind;
  what: string;
  detail: string;
  why: Lateness;
  amount: string;
  /** The screen showing the row this came from. Never null. */
  citation: string;
};

/**
 * Kinds that can be late, and what lateness means for each.
 *
 * Exhaustive by type: a new kind of work will not compile until somebody has
 * said whether it can be late and what that means. The alternative — a default
 * branch — is how a category of overdue work becomes invisible.
 */
const LATENESS: Record<ItemKind, "deadline" | "due" | "unbilled" | "unanswered" | "never"> = {
  tenderDeadline: "deadline",
  complianceExpiry: "deadline",
  unpaidChase: "due",
  uninvoiced: "unbilled",
  awaitingReply: "unanswered",
  // Neither is late in any sense a person would recognise. An unsigned delivery
  // note and a missing NIF are jobs, not overdue jobs, and calling them late
  // would fill the answer with things nobody is waiting for.
  unsignedDelivery: "never",
  missingIdentifier: "never",
  approval: "never",
  note: "never",
};

/** Same window Today and the notification feed use. One idea of "soon". */
export const IMMINENT_HOURS = 48;

function latenessOf(item: Item, now: Date): Lateness | null {
  const rule = LATENESS[item.kind];
  if (rule === "never") return null;

  if (rule === "deadline") {
    const hours = hoursLeft(item.expiresAt, now);
    if (!Number.isFinite(hours)) return null;
    if (hours <= 0) return { reason: "deadlinePassed", hours: Math.abs(Math.round(hours)) };
    if (hours <= IMMINENT_HOURS) return { reason: "deadlineImminent", hours: Math.round(hours) };
    return null;
  }

  // The money and correspondence kinds are only produced by `gather()` when
  // they are already overdue or already unanswered — the queries behind them
  // filter on the date. So their presence IS the fact, and inventing a second
  // threshold here would be this file disagreeing with the screen.
  if (rule === "due") return { reason: "pastDue" };
  if (rule === "unbilled") return { reason: "notBilled" };
  return { reason: "unanswered" };
}

export type LateAnswer = {
  things: LateThing[];
  /** Total money sitting in the answer, in DZD. */
  amount: number;
  /** Counted, not listed — these are somebody else's move. Screen 58 has them. */
  waitingOnOthers: number;
  /** What was examined, so "nothing is late" can be told apart from "nothing was checked". */
  examined: number;
};

export async function whatIsLate(now = new Date()): Promise<LateAnswer> {
  const [current, missed] = await Promise.all([gather(now), missedDeadlines()]);

  // `missedDeadlines` is a different query, not a different id space — a deal
  // cannot be in both, because the two queries split on `deadline_at <= now()`.
  const items = [...missed, ...current];

  const things: LateThing[] = [];
  for (const item of items) {
    // Somebody else's move is not late on your desk. Today makes the same call
    // and screen 58 is where those live.
    if (item.waitingOnThem) continue;

    const why = latenessOf(item, now);
    if (!why) continue;

    things.push({
      id: item.id,
      kind: item.kind,
      what: item.title,
      detail: item.detail,
      why,
      amount: item.amount,
      citation: item.href,
    });
  }

  /**
   * Worst first: a deadline already gone, then one about to go, then money,
   * then correspondence. Within a band, by amount.
   *
   * Deliberately the same shape of ordering as Today's bands — an assistant
   * that ranked work differently from the screen would be a second opinion
   * about what matters, and there is only supposed to be one.
   */
  const rank: Record<Lateness["reason"], number> = {
    deadlinePassed: 0,
    deadlineImminent: 1,
    pastDue: 2,
    notBilled: 3,
    unanswered: 4,
  };

  things.sort(
    (a, b) => rank[a.why.reason] - rank[b.why.reason] || Number(b.amount) - Number(a.amount),
  );

  return {
    things,
    amount: things.reduce((sum, thing) => sum + Number(thing.amount || 0), 0),
    waitingOnOthers: items.filter((item) => item.waitingOnThem).length,
    examined: items.length,
  };
}
