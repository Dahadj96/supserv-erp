import { describe, expect, it } from "vitest";
import {
  bufferHours,
  type ClientRequires,
  compare,
  conflictsOf,
  type LineNeed,
  replyRate,
  type SupplierAnswer,
  totalFor,
  worthChasing,
} from "@/domain/deal/sourcing";

/**
 * Screen 67, with the frame's own line prices.
 *
 * SR-2026-0018 for TouatGaz: five lines, four suppliers asked, two quoted.
 *
 * A NOTE ON THE FRAME'S TOTALS. The mockup's summary card says Hydro-Equip
 * alone is 1 001 700 and splitting saves 8 300. Its own comparison table does
 * not produce those figures: the five lines at the unit prices drawn come to
 * 960 400 and 953 400, a saving of 7 000. The gap is a constant 41 300 on both
 * totals, so the card was almost certainly drawn against a sixth line that the
 * request excludes ("Items 5 of 6 — 1 excluded" is on the same screen).
 *
 * The arithmetic below follows the TABLE, because the table is the data. This
 * is written down so that the next person to compare the screen against the
 * mockup does not "fix" the code to match a headline figure that never
 * reconciled with the rows beneath it.
 */

const LINES: LineNeed[] = [
  { lineId: "l1", qty: "12" }, // Vanne papillon DN80 PN16
  { lineId: "l2", qty: "8" }, // Vanne papillon DN100 PN16
  { lineId: "l3", qty: "40" }, // Raccord bride 2" galvanisé
  { lineId: "l4", qty: "60" }, // Joint EPDM DN80
  { lineId: "l5", qty: "20" }, // Boulonnerie M16 galvanisée
];

function answer(over: Partial<SupplierAnswer> & { responseId: string }): SupplierAnswer {
  return {
    partyId: `p-${over.responseId}`,
    supplierName: "SARL HYDRO-EQUIP",
    status: "quoted",
    validityDays: 30,
    leadTimeDays: 21,
    currency: "DZD",
    prices: new Map(),
    ...over,
  };
}

const HYDRO = answer({
  responseId: "r1",
  supplierName: "SARL HYDRO-EQUIP",
  validityDays: 30,
  leadTimeDays: 21,
  prices: new Map([
    ["l1", "38400"],
    ["l2", "41100"],
    ["l3", "2610"],
    ["l4", "340"],
    ["l5", "2300"],
  ]),
});

const VANNE = answer({
  responseId: "r2",
  supplierName: "Vanne Algérie SPA",
  validityDays: 90,
  leadTimeDays: 34,
  prices: new Map([
    ["l1", "41100"],
    ["l2", "43900"],
    ["l3", "2480"],
    ["l4", "310"],
    ["l5", "2300"],
  ]),
});

const REQUIRES: ClientRequires = {
  validityDays: 90,
  deliveryDays: 21,
  latePenalty: "1‰ par jour",
  currency: "DZD",
  deadlineAt: new Date(Date.UTC(2026, 7, 20, 12, 0)),
};

describe("what one supplier would cost for the whole list", () => {
  it("multiplies by the quantity, not just adds the unit prices", () => {
    // 12×38 400 + 8×41 100 + 40×2 610 + 60×340 + 20×2 300 = 960 400.
    expect(totalFor(HYDRO, LINES)).toBe("960400.00");
  });

  it("refuses to total a supplier who did not price every line", () => {
    // The important refusal. Four prices out of five add up to a number that
    // LOOKS like a total, and that number on a comparison screen is how
    // somebody orders four fifths of a job from one supplier.
    const partial = answer({
      responseId: "r3",
      prices: new Map([
        ["l1", "1"],
        ["l2", "1"],
        ["l3", "1"],
        ["l4", "1"],
      ]),
    });
    expect(totalFor(partial, LINES)).toBeNull();
  });
});

describe("comparing the quotes", () => {
  const result = compare([HYDRO, VANNE], LINES);

  it("picks the cheapest supplier on each line, not overall", () => {
    expect(result.best.get("l1")?.supplierName).toBe("SARL HYDRO-EQUIP");
    expect(result.best.get("l3")?.supplierName).toBe("Vanne Algérie SPA");
    expect(result.best.get("l4")?.supplierName).toBe("Vanne Algérie SPA");
  });

  it("puts the split total and the single-source total side by side", () => {
    // Split: 12×38 400 + 8×41 100 + 40×2 480 + 60×310 + 20×2 300 = 953 400.
    // Single best is Hydro-Equip at 960 400, so splitting saves 7 000.
    expect(result.splitTotal).toBe("953400.00");
    expect(result.singleBest?.total).toBe("960400.00");
    expect(result.saving).toBe("7000.00");
  });

  it("says how many suppliers the split needs, because that is half the decision", () => {
    // Two suppliers means two deliveries, two sets of paperwork, and two
    // chances of one being late against a penalty clause. The function counts;
    // it does not recommend.
    expect(result.splitSuppliers).toBe(2);
  });

  it("names the lines nobody priced rather than quietly leaving them out", () => {
    const thin = answer({
      responseId: "r4",
      prices: new Map([
        ["l1", "100"],
        ["l2", "100"],
      ]),
    });
    const partial = compare([thin], LINES);
    expect(partial.unpricedLines).toEqual(["l3", "l4", "l5"]);
    // And there is no saving to quote, because there is no whole-list price to
    // compare against.
    expect(partial.saving).toBeNull();
    expect(partial.singleBest).toBeNull();
  });

  it("ignores suppliers who declined or never answered", () => {
    const silent = answer({ responseId: "r5", status: "no_reply", prices: new Map([["l1", "1"]]) });
    const result = compare([HYDRO, VANNE, silent], LINES);
    expect(result.best.get("l1")?.supplierName).toBe("SARL HYDRO-EQUIP");
  });
});

const QUOTED_ON = new Map([
  ["r1", new Date(Date.UTC(2026, 7, 17))],
  ["r2", new Date(Date.UTC(2026, 7, 18))],
]);

function conflicts(requires: ClientRequires, answers: SupplierAnswer[]) {
  return conflictsOf({
    requires,
    answers,
    lineIds: LINES.map((l) => l.lineId),
    quotedOn: QUOTED_ON,
    total: (a) => totalFor(a, LINES) ?? "0",
  });
}

describe("conflicts between what the client asked for and what suppliers offer", () => {
  const found = conflicts(REQUIRES, [HYDRO, VANNE]);

  it("finds exactly the two the frame draws", () => {
    expect(found.map((c) => c.kind)).toEqual([
      "validityShorterThanRequired",
      "leadTimeLongerThanRequired",
    ]);
  });

  it("puts the expensive one first", () => {
    // A person reading top to bottom should meet the promise that evaporates
    // before the cost that can be priced in.
    expect(found[0]?.severity).toBe("critical");
    expect(found[1]?.severity).toBe("warning");
  });

  it("says by how much, and until when the supplier is actually held", () => {
    const validity = found[0];
    expect(validity?.supplierName).toBe("SARL HYDRO-EQUIP");
    expect(validity?.clientSide).toBe("90");
    expect(validity?.supplierSide).toBe("30");
    expect(validity?.detail.shortBy).toBe(60);
    // Quoted 17 August, holds 30 days → 16 September. The frame's date.
    expect(validity?.detail.heldUntil).toBe("2026-09-16");
    expect(validity?.detail.amount).toBe("960400.00");
  });

  it("carries the penalty clause into the lead-time conflict", () => {
    const lead = found[1];
    expect(lead?.supplierName).toBe("Vanne Algérie SPA");
    expect(lead?.detail.lateBy).toBe(13);
    expect(lead?.detail.penalty).toBe("1‰ par jour");
  });
});

describe("no requirement, no conflict", () => {
  it("raises nothing when nobody confirmed what the client requires", () => {
    // The whole point. A red box raised against a requirement extraction
    // guessed at is a false alarm, and false alarms teach people to click past
    // red boxes — including the real one, six weeks later.
    const unconfirmed: ClientRequires = {
      validityDays: null,
      deliveryDays: null,
      latePenalty: null,
      currency: "DZD",
      deadlineAt: null,
    };
    expect(conflicts(unconfirmed, [HYDRO, VANNE])).toEqual([]);
  });

  it("raises nothing against a supplier who did not say", () => {
    // Prices given, but no validity and no lead time stated. There is nothing
    // to compare, so nothing is claimed.
    const vague = answer({
      responseId: "r6",
      validityDays: null,
      leadTimeDays: null,
      prices: new Map([["l1", "100"]]),
    });
    expect(conflicts(REQUIRES, [vague])).toEqual([]);
  });

  it("does not scold a supplier who declined", () => {
    const declined = answer({ responseId: "r7", status: "declined", validityDays: 7 });
    expect(conflicts(REQUIRES, [declined])).toEqual([]);
  });

  it("notices a supplier who said quoted and priced nothing", () => {
    const empty = answer({ responseId: "r8", validityDays: 90, leadTimeDays: 21 });
    expect(conflicts(REQUIRES, [empty]).map((c) => c.kind)).toEqual(["pricedNothing"]);
  });

  it("flags a euro quote against a dinar contract as a risk to carry", () => {
    const euro = answer({ responseId: "r9", currency: "EUR", validityDays: 90, leadTimeDays: 21 });
    euro.prices.set("l1", "100");
    expect(conflicts(REQUIRES, [euro]).map((c) => c.kind)).toEqual(["currencyDiffers"]);
  });
});

describe("who replied, and who could never have", () => {
  const answers = [
    HYDRO,
    VANNE,
    answer({ responseId: "r10", supplierName: "ETS Boumediene", status: "no_reply" }),
    answer({ responseId: "r11", supplierName: "Import Sud SARL", status: "declined" }),
    answer({ responseId: "r12", supplierName: "Techno Fluides SNC", status: "bounced" }),
  ];

  it("counts a bounced address apart from a silent supplier", () => {
    // From a reply-rate column they look identical. One is slow; the other is
    // an address that does not exist, and chasing it forever is how a supplier
    // quietly drops out of every comparison for a year.
    const rate = replyRate(answers);
    expect(rate).toMatchObject({ asked: 5, quoted: 2, declined: 1, no_reply: 1, bounced: 1 });
  });

  it("does not put a broken address on the chase list", () => {
    expect(worthChasing(answers).map((a) => a.supplierName)).toEqual(["ETS Boumediene"]);
  });
});

describe("the buffer between the supplier reply-by and the client deadline", () => {
  it("counts the hours nobody counts at four o'clock on a Thursday", () => {
    // Reply-by 17 Aug 17:00, client deadline 20 Aug 12:00 → 67 hours.
    const buffer = bufferHours(new Date(Date.UTC(2026, 7, 17, 17)), REQUIRES.deadlineAt);
    expect(buffer).toBe(67);
  });

  it("goes negative when the request cannot help even if everybody answers", () => {
    const buffer = bufferHours(new Date(Date.UTC(2026, 7, 21, 9)), REQUIRES.deadlineAt);
    expect(buffer).toBeLessThan(0);
  });

  it("says nothing when either date is missing", () => {
    expect(bufferHours(null, REQUIRES.deadlineAt)).toBeNull();
    expect(bufferHours(new Date(), null)).toBeNull();
  });
});
