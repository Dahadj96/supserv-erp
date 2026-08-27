/**
 * Screen 56 — "everything about it is on this page".
 *
 * THE TIMELINE IS NOT AN EVENT TABLE. Almost every row is derived from a record
 * that already exists: a message arrived, a supplier quote came back, a
 * document was issued, a decision was recorded. Writing a second copy of each
 * into an `event` table would mean two versions of every fact, and the day they
 * disagreed there would be no way to tell which one happened.
 *
 * The exception is a note or a logged call — see `src/db/schema/note.ts`. Those
 * have no other home, because nothing in the system saw them.
 *
 * WHAT ORDERS THE PAGE: when the thing HAPPENED, never when the row was
 * written. A call made in the car and typed up that evening happened in the
 * car, and a timeline sorted by insertion puts it after things that came later
 * — which reads as though the sequence of events was different from the one
 * everybody remembers.
 */

/**
 * `in`     — something arrived from outside. An email, a quote, a purchase order.
 * `out`    — something left. A message we sent, a document we issued.
 * `noted`  — a person wrote it down: a note, a call, a meeting.
 * `system` — the software did it, unprompted by anybody. A folder created, a
 *            number reserved, a stage that changed because a fact did.
 *
 * Four rather than a flat list, because the first question a person asks of a
 * timeline is "who moved last" and these four answer it at a glance.
 */
export const EVENT_SIDES = ["in", "out", "noted", "system"] as const;
export type EventSide = (typeof EVENT_SIDES)[number];

export type TimelineEvent = {
  id: string;
  side: EventSide;
  /** messages key under `timeline.what`. */
  what: string;
  /** One line. The subject, the number, the name — the thing itself. */
  title: string;
  /** What it said, verbatim where it came from a person. */
  body: string | null;
  /** Who did it. Null when the system did. */
  actor: string | null;
  at: Date;
  /** Where to go to see the whole of it. */
  href: string | null;
  /** Filenames, references — whatever was attached. */
  chips: string[];
};

/**
 * Newest first, as the frame shows.
 *
 * Ties break on id rather than being left to sort stability, so two events
 * recorded in the same second do not swap places between page loads — which
 * looks like the page changing its mind about what happened.
 */
export function timeline(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id));
}

export type Counts = Record<EventSide, number> & { total: number };

export function countSides(events: TimelineEvent[]): Counts {
  const counts = Object.fromEntries(EVENT_SIDES.map((side) => [side, 0])) as Counts;
  for (const event of events) counts[event.side] += 1;
  counts.total = events.length;
  return counts;
}

/**
 * Who moved last, and how long ago.
 *
 * The single most useful thing a timeline can tell you at a glance, and the
 * reason `side` exists. If the last thing that happened was `out`, the ball is
 * with them; if it was `in`, it is with you. `system` and `noted` are skipped —
 * a folder being created is not somebody's move, and neither is writing a note
 * to yourself.
 */
export type LastMove = { side: "in" | "out"; at: Date; days: number } | null;

export function lastMove(events: TimelineEvent[], now: Date): LastMove {
  const moves = timeline(events).filter(
    (event): event is TimelineEvent & { side: "in" | "out" } =>
      event.side === "in" || event.side === "out",
  );
  const last = moves[0];
  if (!last) return null;

  const days = Math.floor((now.getTime() - last.at.getTime()) / 86_400_000);
  return { side: last.side, at: last.at, days: days > 0 ? days : 0 };
}

/**
 * Group by day, for the date separators the eye needs on a long page.
 *
 * Days with nothing are not returned. A timeline that prints an empty Thursday
 * is padding a page with the absence of events, which tells nobody anything.
 */
export type Day = { date: Date; events: TimelineEvent[] };

export function byDay(events: TimelineEvent[]): Day[] {
  const out = new Map<number, TimelineEvent[]>();

  for (const event of timeline(events)) {
    const at = event.at;
    const key = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
    const list = out.get(key) ?? [];
    list.push(event);
    out.set(key, list);
  }

  return [...out.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([key, list]) => ({ date: new Date(key), events: list }));
}
