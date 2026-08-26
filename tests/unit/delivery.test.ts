import { describe, expect, it } from "vitest";
import {
  type DeliveredLine,
  progress,
  progressOf,
  type SourceLine,
  unlocks,
} from "@/domain/delivery/lines";

/**
 * Screens 49 and 14 — ORD-2026-0046 for BALADNA ALGERIA, nine lines.
 *
 * Screen 14 shows two bons de livraison against it:
 *
 *   BL-2026-0118 · delivered 08 Aug     BL-2026-0124 · planned 22 Aug
 *   1 Galets Ø108      40 / 40          3 Roulements SKF   0 of 12 remaining
 *   2 Bande EP400      60 / 60          5 Moteur réducteur  awaiting supplier
 *   3 Roulements SKF   12 / 24          6 Variateur         awaiting supplier
 *   4 Racleur primaire  4 / 4           7 Capteurs          planned
 *                                       8 Coffret           planned
 *
 * and totals it "4 of 9 lines delivered · 44%".
 *
 * FOUR of nine lines are complete, and the frame prints 44% beside it — which
 * is 4/9 to the nearest point. So its bar is the LINE COUNT, not the quantity.
 * Both are computed here and neither is derived from the other: the count
 * answers "how many are finished", the bar "how much has gone". A bar driven by
 * the line count reads 44% when the four finished lines are the small ones,
 * which flatters, and this order's own quantities show the gap: 116 of 140
 * units have gone, which is 83%.
 *
 * (Three lines complete here, not four: the frame counts line 3 among its four
 * because its 12 of 24 appears on BL-2026-0118, but 12 of 24 is half a line
 * delivered, and it is still owed. The frame's own Status column agrees —
 * it says "Partial".)
 *
 * Written down so nobody "corrects" the percentage to match the mockup.
 */

const line = (position: number, designation: string, qty: string): SourceLine => ({
  lineId: `L${position}`,
  position,
  designation,
  unit: "U",
  qty,
});

const ORDER: SourceLine[] = [
  line(1, "Galets de convoyeur Ø108", "40"),
  line(2, "Bande transporteuse EP400", "60"),
  line(3, "Roulements SKF 6308", "24"),
  line(4, "Racleur primaire", "4"),
  line(5, "Moteur réducteur 5,5 kW", "2"),
  line(6, "Variateur de vitesse", "2"),
  line(7, "Capteurs de bourrage", "6"),
  line(8, "Coffret de commande", "1"),
  line(9, "Boulonnerie et accessoires", "1"),
];

/** BL-2026-0118, issued 08 August. */
const GONE: DeliveredLine[] = [
  { sourceLineId: "L1", qty: "40", issued: true },
  { sourceLineId: "L2", qty: "60", issued: true },
  { sourceLineId: "L3", qty: "12", issued: true },
  { sourceLineId: "L4", qty: "4", issued: true },
];

const at = (position: number, current?: DeliveredLine[]) =>
  progressOf({
    source: ORDER[position - 1] as SourceLine,
    delivered: GONE,
    current,
  });

describe("what has actually been delivered", () => {
  it("adds up the issued bons de livraison and subtracts", () => {
    expect(at(3)).toMatchObject({
      ordered: "24",
      alreadyDelivered: "12",
      thisDelivery: "0",
      remaining: "12",
      state: "partial",
    });
  });

  it("calls a line complete when nothing is left", () => {
    expect(at(1).state).toBe("complete");
    expect(at(1).remaining).toBe("0");
  });

  it("calls a line open when nothing has gone and nothing is planned", () => {
    expect(at(6).state).toBe("open");
    expect(at(6).alreadyDelivered).toBe("0");
  });

  it("counts a DRAFT delivery note as having delivered nothing", () => {
    // LAW 5 — the number IS the issue. A BL with no number is a lorry that has
    // not left, and counting it would let somebody invoice goods still in the
    // warehouse. This is the mistake the screen exists to prevent.
    const draft: DeliveredLine[] = [{ sourceLineId: "L6", qty: "2", issued: false }];
    expect(progressOf({ source: ORDER[5] as SourceLine, delivered: draft }).alreadyDelivered).toBe(
      "0",
    );
  });

  it("separates what has gone from what this delivery carries", () => {
    // BL-2026-0124 takes the remaining 12 roulements.
    const current: DeliveredLine[] = [{ sourceLineId: "L3", qty: "12", issued: false }];
    expect(at(3, current)).toMatchObject({
      alreadyDelivered: "12",
      thisDelivery: "12",
      remaining: "0",
      // Not "complete" — it is not complete until this one is issued.
      state: "completes",
    });
  });

  it("marks a line this delivery only starts as planned", () => {
    const current: DeliveredLine[] = [{ sourceLineId: "L7", qty: "3", issued: false }];
    expect(at(7, current)).toMatchObject({
      alreadyDelivered: "0",
      thisDelivery: "3",
      remaining: "3",
      state: "planned",
    });
  });

  it("says so when more went out than was ordered rather than clamping it", () => {
    // Somebody loaded an extra drum. Silently showing 0 remaining leaves two
    // people arguing about a lorry with nothing on the screen to settle it.
    const over: DeliveredLine[] = [{ sourceLineId: "L4", qty: "6", issued: true }];
    const row = progressOf({ source: ORDER[3] as SourceLine, delivered: over });
    expect(row.state).toBe("over");
    expect(row.alreadyDelivered).toBe("6");
    expect(row.remaining).toBe("0");
  });
});

describe("the order's progress", () => {
  const p = progress({ sources: ORDER, delivered: GONE });

  it("counts the finished lines the way the frame does", () => {
    expect(p.linesComplete).toBe(3);
    expect(p.linesTotal).toBe(9);
  });

  it("measures the bar by quantity, not by line count", () => {
    // 40 + 60 + 12 + 4 = 116 of 40+60+24+4+2+2+6+1+1 = 140.
    expect(p.pct).toBe("83");
  });

  it("counts what is still owed to the client", () => {
    // Everything but lines 1, 2 and 4.
    expect(p.open).toBe(6);
  });

  it("cannot be pushed past a hundred percent by one over-delivery", () => {
    const over = [...GONE, { sourceLineId: "L5", qty: "20", issued: true }];
    // Capping per line keeps five undelivered lines visible instead of a bar
    // that reads 100% while most of the order is still in the warehouse.
    expect(Number(progress({ sources: ORDER, delivered: over }).pct)).toBeLessThanOrEqual(100);
  });

  it("does not divide by an empty order", () => {
    expect(progress({ sources: [], delivered: [] }).pct).toBe("0");
  });
});

describe("what a delivery unlocks", () => {
  const p = progress({ sources: ORDER, delivered: GONE });

  it("allows invoicing what has gone and blocks invoicing what has not", () => {
    const u = unlocks({ progress: p, signedCopyOnFile: null, anythingDelivered: true });
    expect(u.invoiceDelivered).toBe(true);
    expect(u.invoiceEverything).toBe(false);
    expect(u.linesOpen).toBe(6);
  });

  it("names a missing signed copy as the thing that protects the invoice", () => {
    // "Without a signed delivery note, a delivery dispute has no answer."
    expect(
      unlocks({ progress: p, signedCopyOnFile: null, anythingDelivered: true }).proofMissing,
    ).toBe(true);
    expect(
      unlocks({
        progress: p,
        signedCopyOnFile: new Date("2026-08-12"),
        anythingDelivered: true,
      }).proofMissing,
    ).toBe(false);
  });

  it("does not complain about missing proof before anything has been delivered", () => {
    expect(
      unlocks({ progress: p, signedCopyOnFile: null, anythingDelivered: false }).proofMissing,
    ).toBe(false);
  });

  it("allows invoicing everything only once nothing is open", () => {
    const all = progress({
      sources: ORDER,
      delivered: ORDER.map((source) => ({
        sourceLineId: source.lineId,
        qty: source.qty,
        issued: true,
      })),
    });
    expect(
      unlocks({ progress: all, signedCopyOnFile: null, anythingDelivered: true }),
    ).toMatchObject({ invoiceEverything: true, linesOpen: 0 });
  });
});
