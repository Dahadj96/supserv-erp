import { describe, expect, it } from "vitest";
import type { Item, ItemKind } from "@/domain/today/list";
import { MOVABILITY, startOfDay, week, weekNumbers } from "@/domain/today/week";

/**
 * Screen 63 — Week ahead, 19 to 25 August 2026.
 *
 * The frame's own week: three deadlines, two deliveries, one site date, four
 * payments due, and Sunday 23 empty. Its prose card reads "Two of your three
 * deadlines land on Thursday. Preparing the TouatGaz deposit today rather than
 * tomorrow morning is the difference between calm and rushed."
 *
 * The card in its corner is a CONSTRAINT on this code, not a caption:
 *
 *   "Everything on this page also appears on Today when its day comes. This
 *    view exists so you can see a crowded Thursday on Monday, not so you have a
 *    second list to manage."
 *
 * So `week()` takes the same `Item[]` screen 55 is built from and does nothing
 * but lay it out. There is no week-specific source, and the test below that
 * nothing appears here which Today would not is the one that keeps it that way.
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

const WEEK: Item[] = [
  item({ id: "touatgaz", kind: "tenderDeadline", expiresAt: at("2026-08-20T12:00:00Z") }),
  item({ id: "urbacon-pr", kind: "tenderDeadline", expiresAt: at("2026-08-20T16:00:00Z") }),
  item({ id: "sup38", kind: "unpaidChase", expiresAt: at("2026-08-21T00:00:00Z") }),
  item({ id: "bl124", kind: "unsignedDelivery", expiresAt: at("2026-08-22T00:00:00Z") }),
  item({ id: "baladna", kind: "tenderDeadline", expiresAt: at("2026-08-24T00:00:00Z") }),
  // No date at all. True on Tuesday and on Friday alike.
  item({ id: "undated", kind: "unpaidChase", amount: "5640000" }),
];

describe("laying the week out", () => {
  const view = week(WEEK, NOW, NOW);

  it("covers seven days from the day asked for", () => {
    expect(view.days).toHaveLength(7);
    expect(view.from.toISOString().slice(0, 10)).toBe("2026-08-19");
    expect(view.to.toISOString().slice(0, 10)).toBe("2026-08-25");
  });

  it("puts each dated item on the day it falls", () => {
    expect(view.days[1]?.items.map((i) => i.id)).toEqual(["touatgaz", "urbacon-pr"]);
    expect(view.days[2]?.items.map((i) => i.id)).toEqual(["sup38"]);
    expect(view.days[5]?.items.map((i) => i.id)).toEqual(["baladna"]);
  });

  it("leaves undated work off the calendar entirely", () => {
    // An unpaid invoice has no day — it is equally true on Tuesday and Friday.
    // Scattering undated work across a calendar to fill it out is how a week
    // looks busy for no reason.
    expect(view.days.flatMap((d) => d.items).map((i) => i.id)).not.toContain("undated");
    expect(view.total).toBe(5);
  });

  it("shows nothing this page could show that Today could not", () => {
    // The constraint from the frame's own card. Every item laid out here came
    // from the array screen 55 is built from — there is no second source to
    // drift from.
    const laid = view.days.flatMap((d) => d.items);
    for (const row of laid) expect(WEEK).toContain(row);
  });

  it("marks today, and only today", () => {
    expect(view.days.filter((d) => d.isToday)).toHaveLength(1);
    expect(view.days[0]?.isToday).toBe(true);
  });

  it("names the empty days", () => {
    // Sunday 23 and the two others with nothing on them.
    expect(view.quiet.map((d) => d.date.toISOString().slice(0, 10))).toEqual([
      "2026-08-19",
      "2026-08-23",
      "2026-08-25",
    ]);
  });
});

describe("the crowded day", () => {
  it("names Thursday, which carries two of the five", () => {
    const view = week(WEEK, NOW, NOW);
    expect(view.busiest?.date.toISOString().slice(0, 10)).toBe("2026-08-20");
    expect(view.busiestShare).toBe(2);
  });

  it("says nothing when no day is actually crowded", () => {
    // A "busiest day" carrying one of the week's five items is not a warning,
    // it is arithmetic noise, and a page that cries about it stops being read.
    const even = [
      item({ id: "a", kind: "tenderDeadline", expiresAt: at("2026-08-20T09:00:00Z") }),
      item({ id: "b", kind: "tenderDeadline", expiresAt: at("2026-08-21T09:00:00Z") }),
    ];
    expect(week(even, NOW, NOW).busiest).toBeNull();
  });

  it("says nothing about an empty week", () => {
    const empty = week([], NOW, NOW);
    expect(empty.busiest).toBeNull();
    expect(empty.total).toBe(0);
    expect(empty.quiet).toHaveLength(7);
  });
});

describe("what can be moved", () => {
  it("holds client deadlines and compliance expiry fixed", () => {
    expect(MOVABILITY.tenderDeadline).toBe("fixed");
    expect(MOVABILITY.complianceExpiry).toBe("fixed");
  });

  it("calls the relance policy automatic and pausable", () => {
    expect(MOVABILITY.unpaidChase).toBe("automatic");
  });

  it("needs the client to agree before a delivery moves", () => {
    expect(MOVABILITY.unsignedDelivery).toBe("byAgreement");
  });
});

describe("the week in numbers", () => {
  const numbers = weekNumbers({
    items: week(WEEK, NOW, NOW).days.flatMap((d) => d.items),
    dueThisWeek: ["1400000.00", "1993520.00"],
  });

  it("adds up what falls due inside the week", () => {
    expect(numbers.dueIn).toBe("3393520.00");
  });

  it("counts the deadlines rather than valuing them", () => {
    // The frame prints "Money at risk if missed — 1 598 000 DZD". An enquiry
    // has no value until somebody has priced it, and most of these have not
    // been; a figure meaning "the ones we happen to have priced" looks complete
    // and is not. There is deliberately no such field to assert on.
    expect(numbers.deadlines).toBe(3);
    expect(numbers).not.toHaveProperty("atRisk");
  });

  it("counts nothing when the week is empty", () => {
    const none = weekNumbers({ items: [], dueThisWeek: [] });
    expect(none.dueIn).toBe("0.00");
    expect(none.deadlines).toBe(0);
  });
});

describe("day boundaries", () => {
  it("floors to midnight UTC so an evening deadline lands on its own day", () => {
    // 20 August at 23:30 belongs to Thursday, not to Friday morning.
    expect(startOfDay(at("2026-08-20T23:30:00Z")).toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });
});
