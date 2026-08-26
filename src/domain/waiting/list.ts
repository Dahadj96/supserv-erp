/**
 * Screen 58 — Waiting on.
 *
 * The blue banner is the point of the whole page:
 *
 *   "Nothing on this page needs you today. It is here so that when someone goes
 *    quiet, you find out before it costs you."
 *
 * This is the other half of screen 55's promise. Today keeps everything that is
 * somebody else's move OFF the page, on purpose, because a list you cannot act
 * on stops being read. But those things do not stop mattering — a supplier who
 * has not quoted in eight days is how a bid gets submitted at the wrong price,
 * and nobody notices because nothing arrived to notice.
 *
 * So the two pages divide by WHOSE MOVE IT IS, and this one exists to make
 * silence visible. It is checked once a day, not once an hour, and nothing on
 * it is red for being here — only for having been quiet too long.
 */

/**
 * `supplier`  — a quote we asked for and have not received.
 * `client`    — a decision, a document or money.
 * `authority` — things only they can move. Banks, CASNOS, the tax office.
 */
export const WAITING_GROUPS = ["supplier", "client", "authority"] as const;
export type WaitingGroup = (typeof WAITING_GROUPS)[number];

export type Waiting = {
  id: string;
  group: WaitingGroup;
  /** Who owes the answer. */
  who: string;
  /** What we are waiting for, in their words where possible. */
  what: string;
  /** The deal, invoice or document it is against. */
  forRef: string | null;
  forHref: string | null;
  /** When we asked. Null when we never actually did — see `neverAsked`. */
  askedAt: Date | null;
  /** How many times we have chased. */
  chased: number;
  /** The last chase of any kind, or null. */
  lastChasedAt: Date | null;
  /** When the policy says to chase next, when a policy covers this at all. */
  autoChaseAt: Date | null;
  /**
   * True when this is a dead end rather than a slow reply — a bounced address,
   * a supplier who has said no. Screen 67: "A bounced address is not a slow
   * supplier — it is a broken record."
   */
  broken: boolean;
};

/**
 * How long is too long, per group.
 *
 * Different numbers because the groups keep different clocks. A supplier who
 * has not answered a price request in three days is slow; a bank that has not
 * issued a caution in three days is normal. One threshold for all three would
 * either shout about the bank every week or let a supplier sit for a fortnight.
 */
export const QUIET_TOO_LONG: Record<WaitingGroup, number> = {
  supplier: 3,
  client: 7,
  authority: 10,
};

const DAY = 86_400_000;

/**
 * Days since anybody heard anything — measured from the LAST CHASE if there was
 * one, otherwise from when we asked.
 *
 * Chasing restarts the clock. It has to: a supplier chased this morning is not
 * eight days quiet, whatever the original request date says, and a page that
 * insists otherwise sends the same person three emails in a week.
 */
export function quietDays(row: Waiting, now: Date): number | null {
  const since = row.lastChasedAt ?? row.askedAt;
  if (!since) return null;
  const days = Math.floor((now.getTime() - since.getTime()) / DAY);
  return days > 0 ? days : 0;
}

/** Quiet longer than this group tolerates. The header's "4 have been quiet too long". */
export function tooLong(row: Waiting, now: Date): boolean {
  if (row.broken) return false; // A broken record is not a quiet supplier.
  const days = quietDays(row, now);
  return days !== null && days >= QUIET_TOO_LONG[row.group];
}

/** Never actually asked. Screen 58 prints "not requested" rather than 0 days. */
export function neverAsked(row: Waiting): boolean {
  return row.askedAt === null;
}

export type WaitingGroupView = {
  group: WaitingGroup;
  rows: (Waiting & { quiet: number | null; tooLong: boolean })[];
};

export type WaitingOn = {
  groups: WaitingGroupView[];
  total: number;
  /** How many have been quiet past their group's threshold. */
  overdue: number;
  /** Dead ends — bounced addresses and refusals. Counted apart from overdue. */
  broken: number;
};

export function waitingOn(rows: Waiting[], now: Date): WaitingOn {
  const decorated = rows.map((row) => ({
    ...row,
    quiet: quietDays(row, now),
    tooLong: tooLong(row, now),
  }));

  const groups = WAITING_GROUPS.map((group) => ({
    group,
    rows: decorated
      .filter((row) => row.group === group)
      // Quietest first: the whole page is a silence detector, so the longest
      // silence belongs at the top of its group.
      .sort((a, b) => (b.quiet ?? -1) - (a.quiet ?? -1) || a.who.localeCompare(b.who)),
  })).filter((view) => view.rows.length > 0);

  return {
    groups,
    total: decorated.length,
    overdue: decorated.filter((row) => row.tooLong).length,
    broken: decorated.filter((row) => row.broken).length,
  };
}
