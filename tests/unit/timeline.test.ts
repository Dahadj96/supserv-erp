import { describe, expect, it } from "vitest";
import {
  byDay,
  countSides,
  type EventSide,
  lastMove,
  type TimelineEvent,
  timeline,
} from "@/domain/timeline/events";

/**
 * Screen 56 — DEAL-2026-0141, "everything about it is on this page".
 *
 * The frame's own fourteen events, newest first: a chase sent this morning, a
 * supplier quote received yesterday, a call logged yesterday afternoon, four
 * suppliers asked on the 16th, a go decision on the 15th, a folder created on
 * the 14th, and the consultation that arrived on the 14th.
 *
 * Every one of those but the call is derived from a record another table holds.
 * There is no event table, and the reason is the same one screen 55 refuses a
 * task table: a second copy of a fact is a second version of it, and the day
 * they disagree there is no way to tell which one happened.
 */

const NOW = new Date("2026-08-19T09:00:00Z");
const at = (iso: string) => new Date(iso);

const event = (over: Partial<TimelineEvent> & { id: string; side: EventSide }): TimelineEvent => ({
  what: "note",
  title: over.id,
  body: null,
  actor: null,
  at: NOW,
  href: null,
  chips: [],
  ...over,
});

const CHASE = event({
  id: "chase",
  side: "out",
  what: "askedSuppliers",
  at: at("2026-08-19T08:20:00Z"),
});
const QUOTE = event({
  id: "quote",
  side: "in",
  what: "quoteReceived",
  at: at("2026-08-18T17:04:00Z"),
});
const CALL = event({ id: "call", side: "noted", what: "call", at: at("2026-08-18T14:12:00Z") });
const ASKED = event({
  id: "asked",
  side: "out",
  what: "askedSuppliers",
  at: at("2026-08-16T09:30:00Z"),
});
const FOLDER = event({
  id: "folder",
  side: "system",
  what: "draftCreated",
  at: at("2026-08-14T11:05:00Z"),
});
const ARRIVED = event({
  id: "arrived",
  side: "in",
  what: "messageArrived",
  at: at("2026-08-14T11:03:00Z"),
});

const ALL = [ARRIVED, FOLDER, ASKED, CALL, QUOTE, CHASE];

describe("the order of a timeline", () => {
  it("puts the newest first, as the frame does", () => {
    expect(timeline(ALL).map((e) => e.id)).toEqual([
      "chase",
      "quote",
      "call",
      "asked",
      "folder",
      "arrived",
    ]);
  });

  it("orders by when it HAPPENED, never by when it was written", () => {
    // A call made in the car and typed up that evening happened in the car. A
    // timeline sorted by insertion puts it after things that came later, which
    // reads as though the sequence was different from the one everybody
    // remembers. There is no insertion time on an event at all.
    expect(Object.keys(CALL)).not.toContain("createdAt");
    expect(Object.keys(CALL)).not.toContain("recordedAt");
  });

  it("breaks a tie the same way every time", () => {
    // Two events in the same second must not swap places between page loads —
    // that looks like the page changing its mind about what happened.
    const same = at("2026-08-14T11:03:00Z");
    const a = event({ id: "aaa", side: "in", at: same });
    const b = event({ id: "bbb", side: "out", at: same });
    expect(timeline([b, a]).map((e) => e.id)).toEqual(["aaa", "bbb"]);
    expect(timeline([a, b]).map((e) => e.id)).toEqual(["aaa", "bbb"]);
  });

  it("does not mutate what it was given", () => {
    const order = ALL.map((e) => e.id);
    timeline(ALL);
    expect(ALL.map((e) => e.id)).toEqual(order);
  });
});

describe("who moved last", () => {
  it("says the ball is with you when they wrote last", () => {
    const move = lastMove([ARRIVED, ASKED, QUOTE], NOW);
    expect(move?.side).toBe("in");
    // Yesterday at 17:04, read at 09:00 the next morning.
    expect(move?.days).toBe(0);
  });

  it("says it is with them when you wrote last", () => {
    expect(lastMove(ALL, NOW)?.side).toBe("out");
  });

  it("ignores notes and system events", () => {
    // A folder being created is not somebody's move, and neither is writing a
    // note to yourself. Counting them would say the ball moved when nothing
    // left the building.
    const move = lastMove([ASKED, FOLDER, CALL], NOW);
    expect(move?.side).toBe("out");
    expect(move?.at).toEqual(ASKED.at);
    // 16 Aug 09:30 to 19 Aug 09:00 is two days and twenty-three and a half
    // hours. Floored, not rounded: "3 days ago" for something not yet three
    // days old overstates the silence on the one page somebody reads to decide
    // whether to chase.
    expect(move?.days).toBe(2);
  });

  it("says nothing when nothing has been sent or received", () => {
    expect(lastMove([FOLDER, CALL], NOW)).toBeNull();
    expect(lastMove([], NOW)).toBeNull();
  });

  it("never reports negative days", () => {
    const future = event({ id: "f", side: "out", at: at("2026-08-25T00:00:00Z") });
    expect(lastMove([future], NOW)?.days).toBe(0);
  });
});

describe("grouping by day", () => {
  const days = byDay(ALL);

  it("gives one group per day that has something, newest first", () => {
    expect(days.map((d) => d.date.toISOString().slice(0, 10))).toEqual([
      "2026-08-19",
      "2026-08-18",
      "2026-08-16",
      "2026-08-14",
    ]);
  });

  it("does not print a day with nothing on it", () => {
    // A timeline that shows an empty Thursday is padding a page with the
    // absence of events, which tells nobody anything.
    expect(days.map((d) => d.date.toISOString().slice(0, 10))).not.toContain("2026-08-17");
    expect(days.map((d) => d.date.toISOString().slice(0, 10))).not.toContain("2026-08-15");
  });

  it("keeps the newest first inside a day too", () => {
    const eighteenth = days.find((d) => d.date.toISOString().startsWith("2026-08-18"));
    expect(eighteenth?.events.map((e) => e.id)).toEqual(["quote", "call"]);
  });
});

describe("where the rows came from", () => {
  it("counts each side", () => {
    const counts = countSides(ALL);
    expect(counts.in).toBe(2);
    expect(counts.out).toBe(2);
    expect(counts.noted).toBe(1);
    expect(counts.system).toBe(1);
    expect(counts.total).toBe(6);
  });

  it("counts nothing as nothing", () => {
    expect(countSides([]).total).toBe(0);
  });
});
