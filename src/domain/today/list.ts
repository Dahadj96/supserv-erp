/**
 * Screen 55 — Today.
 *
 * The card in the corner of that frame is the specification, and it is worth
 * quoting whole because every decision in this file comes out of it:
 *
 *   "Ordered by what it costs you to ignore it, not by when it arrived. A
 *    deadline that expires tomorrow outranks an email from this morning.
 *    Anything waiting on somebody else is kept off this page on purpose."
 *
 * Three commitments, and each one is a rule this file keeps:
 *
 * 1. COST OF IGNORING, NOT ARRIVAL. Nothing here sorts by `created_at`. An
 *    inbox sorted by arrival is the thing this screen exists to replace — it
 *    puts the most recent noise at the top and lets a tender expire four
 *    screens down.
 *
 * 2. A DEADLINE OUTRANKS AN EMAIL. Not by a tuning weight somebody can nudge:
 *    the bands are ordered, and nothing in a lower band can outrank anything in
 *    a higher one however loud it is.
 *
 * 3. WAITING ON SOMEBODY ELSE IS OFF THE PAGE. The hardest of the three to hold
 *    to, because those items are real work and it feels wrong to hide them. But
 *    a page that lists what you cannot do anything about is a page that stops
 *    being read, and screen 58 exists for exactly that list.
 *
 * THIS FILE INVENTS NO WORK. Every item comes from a fact recorded elsewhere —
 * a deadline on a deal, a balance on an invoice, a delivery note with no signed
 * copy, a message nobody answered. If Today shows it, some other screen already
 * knew it.
 */

/**
 * The four bands, in the order they appear and the order they outrank in.
 *
 * `nowOrLost`  — a deadline that expires today or tomorrow. Miss it and the
 *                opportunity is gone; there is no recovering it next week.
 * `money`      — the things that decide whether cash actually arrives.
 * `waitingOnYou` — somebody is blocked until you answer.
 * `quick`      — under two minutes each. Last, because they are cheap, and on
 *                a page sorted by cost the cheap things belong at the bottom
 *                however satisfying they are to tick.
 */
export const BANDS = ["nowOrLost", "money", "waitingOnYou", "quick"] as const;
export type Band = (typeof BANDS)[number];

/**
 * What each kind of item costs to do, in minutes.
 *
 * These are ESTIMATES and the screen says so — "about 50 minutes". They exist
 * because "7 things need you today" is not an answer to "have I got time before
 * I leave", and a number that is roughly right is worth more than no number.
 *
 * Deliberately coarse and deliberately in one place. Per-item timing learned
 * from behaviour would be a better number and a worse idea: it would need
 * tracking how long somebody takes at their desk, which is surveillance, and it
 * would be wrong for the week somebody is ill.
 */
export const MINUTES: Record<ItemKind, number> = {
  tenderDeadline: 10,
  complianceExpiry: 5,
  unpaidChase: 5,
  uninvoiced: 5,
  unsignedDelivery: 2,
  awaitingReply: 5,
  missingIdentifier: 2,
  approval: 2,
  note: 3,
};

export const ITEM_KINDS = [
  "tenderDeadline",
  "complianceExpiry",
  "unpaidChase",
  "uninvoiced",
  "unsignedDelivery",
  "awaitingReply",
  "missingIdentifier",
  "approval",
  "note",
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Which band a kind belongs to. Fixed, not configurable — see rule 2. */
const BAND_OF: Record<ItemKind, Band> = {
  tenderDeadline: "nowOrLost",
  complianceExpiry: "nowOrLost",
  unpaidChase: "money",
  uninvoiced: "money",
  awaitingReply: "waitingOnYou",
  unsignedDelivery: "quick",
  missingIdentifier: "quick",
  approval: "quick",
  note: "quick",
};

export type Item = {
  id: string;
  kind: ItemKind;
  /** One line. The thing itself. */
  title: string;
  /** One line under it. Why it is here, or what it will cost. */
  detail: string;
  /** Where the button goes. */
  href: string;
  /** messages key for the button, under `today.do`. */
  action: string;
  /**
   * When it stops being possible. Null when nothing expires — an unpaid
   * invoice is not less collectable tomorrow.
   */
  expiresAt: Date | null;
  /**
   * Money at stake, in DZD. Zero when none is. Used only to order WITHIN a
   * band: it never lifts an item into a higher one, because a large invoice
   * that can be chased next week does not outrank a tender that closes at noon.
   */
  amount: string;
  /**
   * True when this is somebody else's move. Kept as a field rather than
   * filtered at the source so `today()` can COUNT them for the closing line —
   * "12 things are waiting on other people" — while keeping them off the list.
   */
  waitingOnThem: boolean;
};

export type BandGroup = {
  band: Band;
  items: Item[];
  minutes: number;
};

export type Today = {
  bands: BandGroup[];
  /** Everything that needs a decision from this person. */
  count: number;
  minutes: number;
  /** On somebody else's desk. Counted, never listed — screen 58 lists them. */
  waitingOnOthers: number;
  /** True when nothing needs a decision. The frame's green card. */
  clear: boolean;
};

const DAY = 86_400_000;

/**
 * Hours until it expires, or Infinity when nothing does.
 *
 * Hours rather than days because "closes tomorrow 12:00" and "closes tomorrow
 * 17:00" are a different amount of trouble when it is already eleven o'clock,
 * and a deadline rounded to days loses exactly the morning that matters.
 */
export function hoursLeft(expiresAt: Date | null, now: Date): number {
  if (!expiresAt) return Number.POSITIVE_INFINITY;
  return (expiresAt.getTime() - now.getTime()) / 3_600_000;
}

/** Does this expire soon enough to be a "now, or it is lost"? */
export function expiringNow(item: Item, now: Date): boolean {
  const hours = hoursLeft(item.expiresAt, now);
  // Today or tomorrow, and not already gone. Something that expired yesterday
  // is not urgent, it is finished, and putting it at the top of the day with a
  // black button is cruelty.
  return hours > 0 && hours <= 48;
}

/**
 * Build the day.
 *
 * Items that are somebody else's move are counted and dropped. Items whose
 * deadline has already passed are dropped too — see `expiringNow`.
 */
export function today(items: Item[], now: Date): Today {
  const waitingOnOthers = items.filter((item) => item.waitingOnThem).length;
  const mine = items.filter((item) => !item.waitingOnThem);

  const kept = mine.filter((item) => {
    if (BAND_OF[item.kind] !== "nowOrLost") return true;
    // A deadline that has not arrived yet is not today's problem, and one that
    // has passed is not a problem at all any more.
    return expiringNow(item, now);
  });

  const bands = BANDS.map((band) => {
    const inBand = kept
      .filter((item) => BAND_OF[item.kind] === band)
      .sort((a, b) => {
        // Soonest to expire first, then most money, then stable by title so two
        // identical rows do not swap places between page loads.
        const byTime = hoursLeft(a.expiresAt, now) - hoursLeft(b.expiresAt, now);
        if (Number.isFinite(byTime) && byTime !== 0) return byTime;
        const byMoney = Number(b.amount) - Number(a.amount);
        if (byMoney !== 0) return byMoney;
        return a.title.localeCompare(b.title);
      });

    return {
      band,
      items: inBand,
      minutes: inBand.reduce((sum, item) => sum + MINUTES[item.kind], 0),
    };
  }).filter((group) => group.items.length > 0);

  const count = bands.reduce((sum, group) => sum + group.items.length, 0);

  return {
    bands,
    count,
    minutes: bands.reduce((sum, group) => sum + group.minutes, 0),
    waitingOnOthers,
    clear: count === 0,
  };
}

/**
 * Screen 63 — "Later this week", the right-hand card.
 *
 * Deliberately a different question from Today's: these are things with a date
 * that is NOT today, shown so nobody is surprised on Friday morning. They carry
 * no buttons, because acting on them today is the opposite of what the page is
 * for.
 */
export type Upcoming = { id: string; title: string; when: Date; href: string };

export function laterThisWeek(items: Item[], now: Date, days = 7): Upcoming[] {
  const horizon = now.getTime() + days * DAY;

  return items
    .filter((item) => {
      if (!item.expiresAt) return false;
      const at = item.expiresAt.getTime();
      // After the 48 hours Today covers, and inside the horizon.
      return at > now.getTime() + 2 * DAY && at <= horizon;
    })
    .sort((a, b) => (a.expiresAt as Date).getTime() - (b.expiresAt as Date).getTime())
    .map((item) => ({
      id: item.id,
      title: item.title,
      when: item.expiresAt as Date,
      href: item.href,
    }));
}
