import { describe, expect, it } from "vitest";
import { collectionOf, elapsedOf, payers, type Settlement } from "@/domain/money/collection";

/**
 * Screen 19's "Quarter to date" card.
 *
 * The frame's figures: 1 256 800 received, 10 834 000 still to collect, 74 days
 * average, best payer SADEG at 31 days, worst payer URBACON at 128 days.
 *
 * 10 834 000 is screen 20's outstanding total to the dinar, and URBACON's 128
 * days is screen 20's oldest UNPAID invoice — SUP/2026/0034, issued 12 April,
 * shown there as 128 d against the same 18 August. The two screens are drawn
 * from one ledger, and that pins the decision documented in `collection.ts`:
 * an unpaid invoice counts towards how long a client takes to pay. Nothing of
 * URBACON's has been settled, so a settled-only average leaves the worst payer
 * in the company off the card entirely.
 */

const TODAY = new Date("2026-08-18T00:00:00Z");
const on = (iso: string) => new Date(`${iso}T00:00:00Z`);

const invoice = (over: Partial<Settlement> & { documentId: string }): Settlement => ({
  partyId: "p1",
  clientName: "SADEG",
  issuedOn: on("2026-07-18"),
  settledOn: null,
  ...over,
});

describe("how long a client takes to pay", () => {
  it("counts a settled invoice from issue to the day the last payment arrived", () => {
    const elapsed = elapsedOf(
      invoice({ documentId: "a", issuedOn: on("2026-06-01"), settledOn: on("2026-07-02") }),
      TODAY,
    );
    expect(elapsed).toEqual({ days: 31, settled: true });
  });

  it("counts an unpaid invoice at the days it has run so far, and says so", () => {
    // SUP/2026/0034 — issued 12 April, never paid, 128 days on 18 August.
    const elapsed = elapsedOf(invoice({ documentId: "b", issuedOn: on("2026-04-12") }), TODAY);
    expect(elapsed).toEqual({ days: 128, settled: false });
  });

  it("has no clock for an invoice that was never issued", () => {
    expect(elapsedOf(invoice({ documentId: "c", issuedOn: null }), TODAY)).toBeNull();
  });

  it("floors a payment dated before the invoice at nought rather than reporting negative days", () => {
    const elapsed = elapsedOf(
      invoice({ documentId: "d", issuedOn: on("2026-07-01"), settledOn: on("2026-06-20") }),
      TODAY,
    );
    expect(elapsed?.days).toBe(0);
  });

  it("does not call a part-paid invoice settled", () => {
    // `settledOn` is null until the allocations cover the total. A client who
    // sends a deposit in a week and the balance in four months took four
    // months, and this is where that is decided.
    const partPaid = invoice({ documentId: "e", issuedOn: on("2026-04-12"), settledOn: null });
    expect(elapsedOf(partPaid, TODAY)?.settled).toBe(false);
  });
});

describe("ranking payers", () => {
  const ledger: Settlement[] = [
    invoice({
      documentId: "s1",
      partyId: "sadeg",
      clientName: "SADEG",
      issuedOn: on("2026-06-01"),
      settledOn: on("2026-07-02"),
    }),
    invoice({
      documentId: "s2",
      partyId: "sadeg",
      clientName: "SADEG",
      issuedOn: on("2026-05-01"),
      settledOn: on("2026-06-01"),
    }),
    invoice({
      documentId: "u1",
      partyId: "urbacon",
      clientName: "URBACON",
      issuedOn: on("2026-04-12"),
    }),
  ];

  it("puts the quickest first and the slowest last", () => {
    const ranked = payers(ledger, TODAY);
    expect(ranked.map((p) => [p.clientName, p.averageDays])).toEqual([
      ["SADEG", 31],
      ["URBACON", 128],
    ]);
  });

  it("counts how many of each client's figures are still moving", () => {
    const ranked = payers(ledger, TODAY);
    expect(ranked.find((p) => p.clientName === "SADEG")?.stillRunning).toBe(0);
    expect(ranked.find((p) => p.clientName === "URBACON")?.stillRunning).toBe(1);
  });

  it("ignores invoices that were never issued", () => {
    const ranked = payers([...ledger, invoice({ documentId: "x", issuedOn: null })], TODAY);
    expect(ranked).toHaveLength(2);
  });
});

describe("the quarter-to-date card", () => {
  const ledger: Settlement[] = [
    invoice({
      documentId: "s1",
      partyId: "sadeg",
      clientName: "SADEG",
      issuedOn: on("2026-06-01"),
      settledOn: on("2026-07-02"),
    }),
    invoice({
      documentId: "u1",
      partyId: "urbacon",
      clientName: "URBACON",
      issuedOn: on("2026-04-12"),
    }),
  ];

  it("reproduces the frame's best and worst payer from one unpaid invoice", () => {
    const card = collectionOf({
      received: [{ amount: "1256800.00", currency: "DZD" }],
      stillToCollect: "10834000.00",
      settlements: ledger,
      today: TODAY,
    });
    expect(card.best?.clientName).toBe("SADEG");
    expect(card.best?.averageDays).toBe(31);
    expect(card.worst?.clientName).toBe("URBACON");
    expect(card.worst?.averageDays).toBe(128);
    expect(card.stillRunning).toBe(1);
    expect(card.received).toBe("1256800.00");
    expect(card.stillToCollect).toBe("10834000.00");
  });

  it("averages over invoices, not over clients", () => {
    // A client with nine quick invoices and a client with one slow one are not
    // half and half. (31 + 128) / 2 = 80 here because there is one of each.
    const card = collectionOf({
      received: [],
      stillToCollect: "0",
      settlements: ledger,
      today: TODAY,
    });
    expect(card.averageDaysToPay).toBe(80);
  });

  it("has no best and no worst when there is only one client", () => {
    const card = collectionOf({
      received: [],
      stillToCollect: "0",
      settlements: [ledger[0] as Settlement],
      today: TODAY,
    });
    expect(card.best).toBeNull();
    expect(card.worst).toBeNull();
    expect(card.averageDaysToPay).toBe(31);
  });

  it("says nothing rather than nought when nothing has been issued", () => {
    const card = collectionOf({
      received: [],
      stillToCollect: "0",
      settlements: [],
      today: TODAY,
    });
    expect(card.averageDaysToPay).toBeNull();
  });

  it("refuses to add euros to dinars, and names them instead", () => {
    const card = collectionOf({
      received: [
        { amount: "1000000.00", currency: "DZD" },
        { amount: "5000.00", currency: "EUR" },
        { amount: "2000.00", currency: "eur" },
      ],
      stillToCollect: "0",
      settlements: [],
      today: TODAY,
    });
    // A converted figure nobody can check is worse than none — no rate has been
    // recorded anywhere in this system.
    expect(card.received).toBe("1000000.00");
    expect(card.otherCurrencies).toEqual(["EUR"]);
    // All three were still recorded. "7 recorded this quarter" counts payments.
    expect(card.payments).toBe(3);
  });
});
