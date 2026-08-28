import { hoursLeft, type Item, type ItemKind } from "../today/list";

/**
 * Screen 33 — Notifications, "grouped by what they block".
 *
 * THIS SCREEN STORES ALMOST NOTHING, and that is the whole design. Read the
 * frame's own items and ask, of each, whether it is an event somebody has to
 * record or a fact somebody could compute:
 *
 *   "TouatGaz closes in 22 hours"          — the deadline, and the clock
 *   "CASNOS expires 30 Aug"                — the certificate's expiry date
 *   "SUP/2026/0042 cannot be issued"       — the client has no NIF
 *   "SUP/2026/0034 is 128 days overdue"    — the due date and the balance
 *   "No supplier reply after 5 days"       — when we asked, and nothing since
 *   "Situation n°3 for 21 days unapproved" — the approval request's age
 *
 * Every one is arithmetic over a fact another screen already holds. A stored
 * notification would be a copy of that arithmetic, made at some moment in the
 * past, that then has to be deleted when the world changes — and the day the
 * payment lands, the "128 days overdue" notification sits there being wrong
 * until a job clears it or somebody ticks it away.
 *
 * So Today's `gather()` is the source for this screen too. Screen 55 and
 * screen 33 are two arrangements of one list: Today asks *what should I do
 * now*, Notifications asks *what is blocked, and by what*. The differences are
 * exactly three, and they are the only reason this file exists:
 *
 *   1. Grouping is by what a thing BLOCKS, not by what it costs to ignore.
 *   2. Items waiting on other people are INCLUDED. Today deliberately hides
 *      them, because you cannot act on them; a notification list that hid them
 *      would fail at the one job it has, which is telling you something has
 *      gone quiet.
 *   3. Read state, which is the single thing here that is genuinely stored —
 *      because "I have seen this" is a fact about a person, and no amount of
 *      arithmetic over invoices will ever produce it.
 */

export const NOTIFY_GROUPS = ["blocking", "money", "work"] as const;
export type NotifyGroup = (typeof NOTIFY_GROUPS)[number];

/**
 * Which group a kind belongs to. Fixed, not configurable.
 *
 * "Blocking now" is not a severity, it is a claim about consequence: if you do
 * nothing today, something becomes impossible. A deadline passes and the bid
 * cannot be submitted. A certificate expires and the deposit is refused. A NIF
 * is missing and the invoice cannot be issued at all.
 *
 * An overdue invoice is NOT blocking, however large. It is not less collectable
 * tomorrow, and putting it in the top group would make the top group mean
 * "important", which is what every notification list dies of.
 */
const GROUP_OF: Record<ItemKind, NotifyGroup> = {
  tenderDeadline: "blocking",
  complianceExpiry: "blocking",
  missingIdentifier: "blocking",
  unpaidChase: "money",
  uninvoiced: "money",
  awaitingReply: "work",
  approval: "work",
  unsignedDelivery: "work",
  note: "work",
};

/** The chips across the top. `mentions` and `system` are deliberately absent. */
export const NOTIFY_FACETS = ["all", "unread", "deadlines", "money", "compliance", "work"] as const;
export type NotifyFacet = (typeof NOTIFY_FACETS)[number];

export function isNotifyFacet(value: string | undefined): value is NotifyFacet {
  return NOTIFY_FACETS.includes(value as NotifyFacet);
}

/**
 * The frame also draws `Mentions 1` and `System 3`. Neither is built: nobody
 * can mention anybody — there are no comments — and nothing emits a system
 * event. Screen 02 set the rule when it refused an "Admin" chip whose count
 * could only ever read zero, and it holds here: a chip that always says 0
 * teaches people to stop reading the chips, which costs more than the chip
 * was ever worth.
 */

export type Notification = Item & {
  group: NotifyGroup;
  read: boolean;
  /** Inside 48 hours of expiring. Drawn red, and ordered first. */
  urgent: boolean;
};

/** Inside this, a deadline is drawn red. Same figure screen 02 uses. */
export const URGENT_HOURS = 48;

export function decorate(items: Item[], readKeys: ReadonlySet<string>, now: Date): Notification[] {
  return items.map((item) => ({
    ...item,
    group: GROUP_OF[item.kind],
    read: readKeys.has(item.id),
    urgent: item.expiresAt !== null && hoursLeft(item.expiresAt, now) <= URGENT_HOURS,
  }));
}

export function matchesFacet(notification: Notification, facet: NotifyFacet): boolean {
  switch (facet) {
    case "all":
      return true;
    case "unread":
      return !notification.read;
    case "deadlines":
      return notification.kind === "tenderDeadline";
    case "compliance":
      return notification.kind === "complianceExpiry";
    case "money":
      return notification.group === "money";
    case "work":
      return notification.group === "work";
  }
}

export type NotifyGroupView = {
  group: NotifyGroup;
  items: Notification[];
};

export type Feed = {
  groups: NotifyGroupView[];
  unread: number;
  total: number;
};

/**
 * Ordering inside a group: unread first, then whatever expires soonest, then
 * the largest amount, then the most recent.
 *
 * Unread first is the one that needs defending, because it means the list
 * REARRANGES as you read it. That is right here and wrong on Today: this page
 * is a queue you work down until it is empty, and an item you have already seen
 * dropping below one you have not is the queue doing its job. Today is a plan
 * for a morning, and a plan that reshuffles while you read it is not a plan.
 */
function compare(a: Notification, b: Notification): number {
  if (a.read !== b.read) return a.read ? 1 : -1;

  const aExpiry = a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bExpiry = b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aExpiry !== bExpiry) return aExpiry - bExpiry;

  const amount = Number(b.amount) - Number(a.amount);
  if (amount !== 0) return amount;

  return a.title.localeCompare(b.title);
}

export function feed(
  items: Item[],
  readKeys: ReadonlySet<string>,
  now: Date,
  facet: NotifyFacet = "all",
): Feed {
  const all = decorate(items, readKeys, now);
  const wanted = all.filter((notification) => matchesFacet(notification, facet));

  const groups = NOTIFY_GROUPS.map((group) => ({
    group,
    items: wanted.filter((notification) => notification.group === group).sort(compare),
  })).filter((view) => view.items.length > 0);

  return {
    groups,
    // Counted over EVERYTHING, not over the current facet. "12 unread" that
    // changed when you clicked a chip would be describing the chip, not the
    // work.
    unread: all.filter((notification) => !notification.read).length,
    total: all.length,
  };
}

export type FacetCounts = Record<NotifyFacet, number>;

export function counts(items: Item[], readKeys: ReadonlySet<string>, now: Date): FacetCounts {
  const all = decorate(items, readKeys, now);
  return NOTIFY_FACETS.reduce((acc, facet) => {
    acc[facet] = all.filter((notification) => matchesFacet(notification, facet)).length;
    return acc;
  }, {} as FacetCounts);
}
