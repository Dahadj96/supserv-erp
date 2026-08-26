import { describe, expect, it } from "vitest";
import {
  expiringNow,
  hoursLeft,
  type Item,
  type ItemKind,
  laterThisWeek,
  MINUTES,
  today,
} from "@/domain/today/list";

/**
 * Screen 55 — Today, with the frame's own seven items.
 *
 *   Now, or it is lost   TouatGaz 25/DA/2026 closes tomorrow 12:00
 *                        CASNOS expires 30 Aug, before the AONR deposit
 *   Money                Urbacon owes 5 640 000 DZD, 128 days
 *                        ORD-2026-0044 delivered 06 Aug, never invoiced
 *   People waiting       A. Himer asked about the fridge specification
 *                        dormakaba confirmed EUR 4 180 and asks for a PO
 *                        Call back S. Lounis about the Reggane crew
 *   Under two minutes    Confirm Baladna NIF · Approve 4 tasks · Attach BL
 *
 * "7 things need you today · about 50 minutes." The frame's own band totals are
 * 15 + 10 + 20 + 5 = 50 minutes across 2 + 2 + 3 + 3 = TEN items, not seven.
 * Its header and its bands disagree; the code counts rows. Written down so
 * nobody reconciles the code to the headline.
 *
 * The card in the corner is the specification these tests actually check:
 *
 *   "Ordered by what it costs you to ignore it, not by when it arrived. A
 *    deadline that expires tomorrow outranks an email from this morning.
 *    Anything waiting on somebody else is kept off this page on purpose."
 */

const NOW = new Date("2026-08-19T09:00:00Z");
const at = (iso: string) => new Date(iso);

const item = (over: Partial<Item> & { id: string; kind: ItemKind }): Item => ({
  title: over.id,
  detail: "",
  href: "/",
  action: "open",
  expiresAt: null,
  amount: "0",
  waitingOnThem: false,
  ...over,
});

const TOUATGAZ = item({
  id: "touatgaz",
  kind: "tenderDeadline",
  title: "TouatGaz 25/DA/2026",
  expiresAt: at("2026-08-20T12:00:00Z"),
});
const CASNOS = item({
  id: "casnos",
  kind: "complianceExpiry",
  title: "CASNOS",
  expiresAt: at("2026-08-30T00:00:00Z"),
});
const URBACON = item({
  id: "urbacon",
  kind: "unpaidChase",
  title: "Urbacon",
  amount: "5640000",
});
const UNINVOICED = item({ id: "ord44", kind: "uninvoiced", title: "ORD-2026-0044" });
const HIMER = item({ id: "himer", kind: "awaitingReply", title: "A. Himer" });
const NIF = item({ id: "nif", kind: "missingIdentifier", title: "Baladna NIF" });

describe("what counts as today", () => {
  it("keeps a deadline that expires tomorrow", () => {
    expect(expiringNow(TOUATGAZ, NOW)).toBe(true);
  });

  it("keeps a deadline eleven days out off the page", () => {
    // CASNOS expires on the 30th. It is real, it matters, and it is not today's
    // problem — it belongs in "Later this week", not above an invoice.
    expect(expiringNow(CASNOS, NOW)).toBe(false);
  });

  it("drops a deadline that has already passed", () => {
    // Putting an expired tender at the top of the day under a black button is
    // not urgency, it is cruelty.
    const gone = item({
      id: "gone",
      kind: "tenderDeadline",
      expiresAt: at("2026-08-18T12:00:00Z"),
    });
    expect(expiringNow(gone, NOW)).toBe(false);
    expect(today([gone], NOW).count).toBe(0);
  });

  it("measures in hours, not days", () => {
    // "Closes tomorrow 12:00" and "closes tomorrow 17:00" are a different
    // amount of trouble when it is already nine o'clock.
    expect(hoursLeft(at("2026-08-20T12:00:00Z"), NOW)).toBe(27);
    expect(hoursLeft(null, NOW)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("the order of the day", () => {
  const day = today([HIMER, URBACON, TOUATGAZ, NIF, UNINVOICED], NOW);

  it("puts the bands in the order they outrank in", () => {
    expect(day.bands.map((group) => group.band)).toEqual([
      "nowOrLost",
      "money",
      "waitingOnYou",
      "quick",
    ]);
  });

  it("lets nothing in a lower band outrank anything in a higher one", () => {
    // 5 640 000 DZD is the largest thing on the page and it is still below a
    // tender closing tomorrow. Not a tuning weight somebody can nudge — the
    // bands are ordered.
    const first = day.bands[0]?.items[0];
    expect(first?.id).toBe("touatgaz");
  });

  it("orders inside a band by what expires first, then by money", () => {
    const money = today(
      [
        item({ id: "small", kind: "unpaidChase", amount: "100000" }),
        item({ id: "large", kind: "unpaidChase", amount: "5640000" }),
      ],
      NOW,
    );
    expect(money.bands[0]?.items.map((i) => i.id)).toEqual(["large", "small"]);
  });

  it("never sorts by when something arrived", () => {
    // The whole reason this page exists rather than an inbox. There is no
    // arrival time on an item at all — it cannot be sorted by one.
    expect(Object.keys(TOUATGAZ)).not.toContain("createdAt");
    expect(Object.keys(TOUATGAZ)).not.toContain("receivedAt");
  });

  it("counts the rows and the minutes", () => {
    expect(day.count).toBe(5);
    expect(day.minutes).toBe(
      MINUTES.tenderDeadline +
        MINUTES.unpaidChase +
        MINUTES.uninvoiced +
        MINUTES.awaitingReply +
        MINUTES.missingIdentifier,
    );
  });

  it("drops empty bands rather than printing an empty heading", () => {
    expect(today([HIMER], NOW).bands.map((g) => g.band)).toEqual(["waitingOnYou"]);
  });
});

describe("what is deliberately not on the page", () => {
  it("keeps what is waiting on somebody else off it, and counts them", () => {
    const theirs = [
      item({ id: "t1", kind: "awaitingReply", waitingOnThem: true }),
      item({ id: "t2", kind: "unpaidChase", waitingOnThem: true }),
    ];
    const day = today([HIMER, ...theirs], NOW);

    expect(day.count).toBe(1);
    expect(day.bands.flatMap((g) => g.items).map((i) => i.id)).toEqual(["himer"]);
    // Counted, so the closing line can say "2 things are waiting on other
    // people" rather than the page silently appearing to have missed them.
    expect(day.waitingOnOthers).toBe(2);
  });

  it("says the day is clear only when nothing needs a decision", () => {
    expect(today([], NOW).clear).toBe(true);
    expect(today([item({ id: "x", kind: "awaitingReply", waitingOnThem: true })], NOW).clear).toBe(
      true,
    );
    expect(today([HIMER], NOW).clear).toBe(false);
  });
});

describe("later this week", () => {
  it("shows what has a date after today and before the week is out", () => {
    const later = laterThisWeek([TOUATGAZ, CASNOS, URBACON], NOW);
    // TouatGaz is today's problem, Urbacon has no date at all, and CASNOS is
    // eleven days out — past the seven-day horizon.
    expect(later).toEqual([]);
  });

  it("catches the one three days out", () => {
    const friday = item({
      id: "urbacon-pr",
      kind: "tenderDeadline",
      title: "Urbacon PR 3000116322",
      expiresAt: at("2026-08-22T00:00:00Z"),
    });
    expect(laterThisWeek([TOUATGAZ, friday], NOW).map((r) => r.id)).toEqual(["urbacon-pr"]);
  });

  it("puts the soonest first", () => {
    const a = item({ id: "a", kind: "tenderDeadline", expiresAt: at("2026-08-24T00:00:00Z") });
    const b = item({ id: "b", kind: "tenderDeadline", expiresAt: at("2026-08-22T00:00:00Z") });
    expect(laterThisWeek([a, b], NOW).map((r) => r.id)).toEqual(["b", "a"]);
  });
});
