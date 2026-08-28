import { describe, expect, it } from "vitest";
import { counts, feed, NOTIFY_FACETS, URGENT_HOURS } from "@/domain/notify/feed";
import { ITEM_KINDS, type Item, type ItemKind } from "@/domain/today/list";

const NOW = new Date("2026-08-27T09:00:00Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

function item(kind: ItemKind, over: Partial<Item> = {}): Item {
  return {
    id: `${kind}:${over.id ?? "1"}`,
    kind,
    title: kind,
    detail: "",
    href: "/",
    action: "open",
    expiresAt: null,
    amount: "0",
    waitingOnThem: false,
    ...over,
    // `id` above is built from the override, so re-apply it deliberately.
    ...(over.id ? { id: over.id } : {}),
  };
}

describe("grouped by what they block", () => {
  it("puts the three that make something impossible in Blocking now", () => {
    const items = [
      item("tenderDeadline", { id: "a", expiresAt: inHours(22) }),
      item("complianceExpiry", { id: "b", expiresAt: inHours(72) }),
      item("missingIdentifier", { id: "c" }),
    ];
    const { groups } = feed(items, new Set(), NOW);
    expect(groups.map((g) => g.group)).toEqual(["blocking"]);
    expect(groups[0]?.items).toHaveLength(3);
  });

  it("does not treat a big overdue invoice as blocking", () => {
    // It is not less collectable tomorrow. Putting money in the top group makes
    // the top group mean "important", which is what every such list dies of.
    const items = [item("unpaidChase", { id: "x", amount: "5640000" })];
    const { groups } = feed(items, new Set(), NOW);
    expect(groups[0]?.group).toBe("money");
  });

  it("has a group for every kind Today can produce", () => {
    // A kind with no group would vanish from this screen without a word.
    const items = ITEM_KINDS.map((kind) => item(kind, { id: kind }));
    const { groups, total } = feed(items, new Set(), NOW);
    expect(total).toBe(ITEM_KINDS.length);
    expect(groups.flatMap((g) => g.items)).toHaveLength(ITEM_KINDS.length);
  });
});

describe("what Today hides and this shows", () => {
  it("includes things waiting on other people", () => {
    // Today hides these on purpose - you cannot act on them. A notification
    // list that hid them would fail at its only job: saying something has
    // gone quiet.
    const items = [item("awaitingReply", { id: "q", waitingOnThem: true })];
    expect(feed(items, new Set(), NOW).total).toBe(1);
  });
});

describe("read state", () => {
  const items = [item("unpaidChase", { id: "seen" }), item("unpaidChase", { id: "fresh" })];

  it("marks what the person has already seen", () => {
    const { groups } = feed(items, new Set(["seen"]), NOW);
    const byId = Object.fromEntries(groups[0]?.items.map((i) => [i.id, i.read]) ?? []);
    expect(byId).toEqual({ seen: true, fresh: false });
  });

  it("sorts unread above read", () => {
    const { groups } = feed(items, new Set(["seen"]), NOW);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["fresh", "seen"]);
  });

  it("counts unread across everything, not just the visible chip", () => {
    // A count that changed when you clicked a chip would be describing the
    // chip rather than the work.
    const { unread } = feed(items, new Set(["seen"]), NOW, "money");
    expect(unread).toBe(1);
  });
});

describe("urgency", () => {
  it("is inside 48 hours, and only for things that expire", () => {
    const soon = item("tenderDeadline", { id: "soon", expiresAt: inHours(URGENT_HOURS - 1) });
    const later = item("tenderDeadline", { id: "later", expiresAt: inHours(URGENT_HOURS + 5) });
    const never = item("unpaidChase", { id: "never" });

    const all = feed([soon, later, never], new Set(), NOW).groups.flatMap((g) => g.items);
    const byId = Object.fromEntries(all.map((i) => [i.id, i.urgent]));
    expect(byId).toEqual({ soon: true, later: false, never: false });
  });

  it("orders the soonest deadline first", () => {
    const items = [
      item("tenderDeadline", { id: "late", expiresAt: inHours(40) }),
      item("tenderDeadline", { id: "early", expiresAt: inHours(4) }),
    ];
    const { groups } = feed(items, new Set(), NOW);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["early", "late"]);
  });
});

describe("the chips", () => {
  const items = [
    item("tenderDeadline", { id: "d", expiresAt: inHours(10) }),
    item("complianceExpiry", { id: "c", expiresAt: inHours(200) }),
    item("unpaidChase", { id: "m" }),
    item("approval", { id: "w" }),
  ];

  it("counts each facet over the same list", () => {
    const c = counts(items, new Set(["d"]), NOW);
    expect(c.all).toBe(4);
    expect(c.unread).toBe(3);
    expect(c.deadlines).toBe(1);
    expect(c.compliance).toBe(1);
    expect(c.money).toBe(1);
    expect(c.work).toBe(1);
  });

  it("offers no chip that can only ever read zero", () => {
    // The frame draws Mentions and System. Nothing can mention anybody - there
    // are no comments - and nothing emits a system event. Screen 02 set this
    // rule and it holds here.
    expect(NOTIFY_FACETS).not.toContain("mentions");
    expect(NOTIFY_FACETS).not.toContain("system");
  });

  it("filters to what the chip says", () => {
    const { groups } = feed(items, new Set(), NOW, "deadlines");
    expect(groups.flatMap((g) => g.items).map((i) => i.id)).toEqual(["d"]);
  });
});
