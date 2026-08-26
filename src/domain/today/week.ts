import Decimal from "decimal.js";
import type { Item, ItemKind } from "./list";

/**
 * Screen 63 — Week ahead.
 *
 * The card in the corner is a constraint on the implementation, not a note to
 * the reader:
 *
 *   "Everything on this page also appears on Today when its day comes. This
 *    view exists so you can see a crowded Thursday on Monday, not so you have a
 *    second list to manage."
 *
 * So this file takes the SAME `Item[]` screen 55 is built from and does nothing
 * but lay it out across seven days. There is no second query, no week-specific
 * source, and nothing here can show something Today will not. A separate feed
 * would drift the first week somebody added an item kind to one and not the
 * other, and the drift would be invisible — two pages that disagree about what
 * is happening on Thursday, neither obviously wrong.
 */

const DAY = 86_400_000;

/**
 * Whether a thing can be moved, and by whom. Screen 63's "What is fixed and
 * what can move".
 *
 * A property of the KIND, not of the item — a client's deadline is fixed
 * because a client set it, and no amount of wishing about one particular tender
 * changes that. Worth stating on the page because the difference between a week
 * that works and one that does not is usually which of these somebody realised
 * they could shift.
 */
export const MOVABILITY: Record<ItemKind, "fixed" | "byAgreement" | "automatic" | "yours"> = {
  tenderDeadline: "fixed",
  complianceExpiry: "fixed",
  // A delivery date is a promise to a client, so it moves only if they agree.
  uninvoiced: "yours",
  unsignedDelivery: "byAgreement",
  // The relance policy fires on its own; a person can pause it.
  unpaidChase: "automatic",
  awaitingReply: "yours",
  missingIdentifier: "yours",
  approval: "yours",
  note: "yours",
};

export type WeekDay = {
  /** Midnight UTC of the day. */
  date: Date;
  items: Item[];
  isToday: boolean;
};

export type Week = {
  days: WeekDay[];
  from: Date;
  to: Date;
  /** Days with nothing on them. Screen 63's "Quiet days — use them". */
  quiet: WeekDay[];
  /** The day carrying the most. Null when the week is even or empty. */
  busiest: WeekDay | null;
  /** How many of the week's items are on the busiest day. */
  busiestShare: number;
  /** Items with a date, across the whole week. */
  total: number;
};

/** Midnight UTC of the day `date` falls in. */
export function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * The seven days from `from`, with every dated item on the day it falls.
 *
 * Undated items are not here at all. An unpaid invoice has no day — it is
 * equally true on Tuesday and Friday — and scattering undated work across a
 * calendar to fill it out is how a week looks busy for no reason.
 */
export function week(items: Item[], from: Date, now: Date, days = 7): Week {
  const start = startOfDay(from);
  const todayAt = startOfDay(now).getTime();

  const laid: WeekDay[] = Array.from({ length: days }, (_, index) => {
    const date = new Date(start.getTime() + index * DAY);
    return {
      date,
      isToday: date.getTime() === todayAt,
      items: items.filter((item) => {
        if (!item.expiresAt) return false;
        return startOfDay(item.expiresAt).getTime() === date.getTime();
      }),
    };
  });

  const total = laid.reduce((sum, day) => sum + day.items.length, 0);
  const most = laid.reduce((best, day) => (day.items.length > best.items.length ? day : best), {
    items: [],
  } as unknown as WeekDay);

  return {
    days: laid,
    from: start,
    to: new Date(start.getTime() + (days - 1) * DAY),
    quiet: laid.filter((day) => day.items.length === 0),
    // Only worth naming when it actually carries more than a day's share. A
    // "busiest day" with two of the week's fourteen items is not a warning, it
    // is arithmetic noise.
    busiest: most.items.length >= 2 && most.items.length > total / days ? most : null,
    busiestShare: most.items.length,
    total,
  };
}

export type WeekNumbers = {
  /** Invoices falling due inside the week. */
  dueIn: string;
  /** Deadlines this week that could be missed. Counted, never valued —
   *  see the note below. */
  deadlines: number;
  deliveries: number;
  chases: number;
};

/**
 * Screen 63's "This week in numbers".
 *
 * The frame prints "Money at risk if missed — 1 598 000 DZD" beside the
 * deadlines. THAT FIGURE IS NOT COMPUTED HERE, and the omission is deliberate:
 * an enquiry has no value until somebody has priced it, and most of the ones
 * with a deadline this week have not been. Printing a number that silently
 * means "the ones we happen to have priced" would be worse than printing none,
 * because it looks complete.
 *
 * The count of deadlines is real, and it is what a person acts on anyway.
 */
export function weekNumbers(opts: {
  items: Item[];
  /** Invoice balances falling due inside the week, already filtered. */
  dueThisWeek: string[];
}): WeekNumbers {
  const dueIn = opts.dueThisWeek.reduce(
    (sum, amount) => sum.plus(new Decimal(amount || "0")),
    new Decimal(0),
  );

  return {
    dueIn: dueIn.toDecimalPlaces(2).toFixed(2),
    deadlines: opts.items.filter((item) => item.kind === "tenderDeadline").length,
    deliveries: opts.items.filter((item) => item.kind === "unsignedDelivery").length,
    chases: opts.items.filter((item) => item.kind === "unpaidChase").length,
  };
}
