import { describe, expect, it } from "vitest";
import {
  ageingOf,
  ageOf,
  balanceOf,
  bucketOf,
  daysLate,
  isOverdue,
  mostNeglected,
  type Owing,
  SILENT_DAYS_BEFORE_NEGLECTED,
} from "@/domain/money/ageing";

/**
 * Screen 20 — Ageing.
 *
 * `docs/PLAN.md` names "overdue was an invoice status" as one of two bugs LAW 1
 * found in the Figma file. It is not a status: nothing transitions an invoice
 * to overdue, a date passes while a balance is still owed. Every test here
 * passes `today` in, so there is no hidden clock to disagree with.
 *
 * The dates below are screen 20's own, and they reconcile exactly — every Age
 * badge and every bucket total — with `today = 18 August 2026` and age measured
 * from the ISSUE date. That is what settled which clock the buckets use.
 */

const TODAY = new Date(Date.UTC(2026, 7, 18));
const day = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d));

let n = 0;
function owing(over: Partial<Owing> = {}): Owing {
  n += 1;
  return {
    documentId: `doc-${n}`,
    number: `SUP/2026/00${n}`,
    partyId: "party-1",
    clientName: "URBACON (UCC)",
    issuedOn: day(8, 1),
    dueOn: day(8, 10),
    totalIncl: "100000",
    paid: "0",
    currency: "DZD",
    lastRelanceAt: null,
    ...over,
  };
}

describe("balance is computed, and overdue is not a state", () => {
  it("subtracts what was allocated", () => {
    expect(balanceOf({ totalIncl: "5640000", paid: "1000000" })).toBe("4640000.00");
    expect(balanceOf({ totalIncl: "100", paid: "100" })).toBe("0.00");
  });

  it("is overdue only while something is still owed", () => {
    const late = { dueOn: day(8, 10), totalIncl: "100", paid: "0" };
    expect(isOverdue(late, TODAY)).toBe(true);
    // Paid, however late it was. Nothing to chase.
    expect(isOverdue({ ...late, paid: "100" }, TODAY)).toBe(false);
    // Not yet due.
    expect(isOverdue({ ...late, dueOn: day(9, 30) }, TODAY)).toBe(false);
  });
});

/**
 * A situation de travaux bills the work in full and the client keeps back the
 * retenue de garantie. Counting its TTC as owed made the ERP chase a wilaya
 * for money the CCAP says they may hold.
 */
describe("a paper that asks for less than it is worth", () => {
  const situation = {
    // 1 856 400 of work, 78 000 of retention, 100 000 of advance recovered.
    totalIncl: "1856400",
    owedNow: "1678400",
    dueOn: day(8, 10),
  };

  it("is settled when the client has paid what it asked for", () => {
    expect(balanceOf({ ...situation, paid: "1678400" })).toBe("0.00");
    expect(isOverdue({ ...situation, paid: "1678400" }, TODAY)).toBe(false);
  });

  it("does not become a debt because the retention is still held", () => {
    // The old arithmetic left 178 000 outstanding, ninety days old, on a
    // situation the client had paid to the centime.
    expect(balanceOf({ totalIncl: "1856400", paid: "1678400" })).toBe("178000.00");
  });

  it("still shows what is actually late when part of the net is unpaid", () => {
    expect(balanceOf({ ...situation, paid: "1000000" })).toBe("678400.00");
    expect(isOverdue({ ...situation, paid: "1000000" }, TODAY)).toBe(true);
  });

  it("leaves every ordinary invoice exactly as it was", () => {
    // No `owedNow`: the TTC is what was asked for, which is the common case.
    expect(balanceOf({ totalIncl: "5640000", paid: "1000000" })).toBe("4640000.00");
  });

  it("keeps a retention-holding situation out of the ageing report", () => {
    const report = ageingOf(
      [
        owing({ ...situation, paid: "1678400" }),
        owing({ totalIncl: "200000", paid: "0", issuedOn: day(4, 12) }),
      ],
      TODAY,
    );
    expect(report.invoices).toBe(1);
    expect(report.total).toBe("200000.00");
  });
});

describe("two clocks, kept apart", () => {
  it("ages from the issue date and counts lateness from the due date", () => {
    // Issued 12 April, due 12 May, and screen 20 shows this one as 128 d.
    expect(ageOf(day(4, 12), TODAY)).toBe(128);
    expect(daysLate(day(5, 12), TODAY)).toBe(98);
  });

  it("calls an invoice on long terms old but not late", () => {
    // Sixty days out on ninety-day terms. Both facts are true; collapsing them
    // either flatters the report or accuses a client who paid on time.
    const issued = day(6, 19);
    const due = day(9, 17);
    expect(ageOf(issued, TODAY)).toBe(60);
    expect(daysLate(due, TODAY)).toBe(0);
  });

  it("never returns a negative for either", () => {
    expect(ageOf(day(12, 1), TODAY)).toBe(0);
    expect(daysLate(day(12, 1), TODAY)).toBe(0);
    expect(ageOf(null, TODAY)).toBe(0);
    expect(daysLate(null, TODAY)).toBe(0);
  });
});

describe("which column an invoice falls in", () => {
  it("puts each age in the bucket screen 20 draws", () => {
    expect(bucketOf(day(8, 1), TODAY)).toBe("d0_30"); // 17 d
    expect(bucketOf(day(6, 19), TODAY)).toBe("d31_60"); // 60 d
    expect(bucketOf(day(6, 1), TODAY)).toBe("d61_90"); // 78 d
    expect(bucketOf(day(4, 12), TODAY)).toBe("over90"); // 128 d
  });

  it("puts an invoice issued today in the first bucket, not a fifth one", () => {
    // There is no "not yet due" column on screen 20, and inventing one would
    // put money nobody could find in a bucket nobody looks at.
    expect(bucketOf(TODAY, TODAY)).toBe("d0_30");
  });
});

/** Screen 20's five unpaid invoices, exactly as drawn. */
const LEDGER: Owing[] = [
  owing({
    number: "SUP/2026/0034",
    clientName: "URBACON (UCC)",
    partyId: "urbacon",
    issuedOn: day(4, 12),
    dueOn: day(5, 12),
    totalIncl: "5640000",
    lastRelanceAt: day(7, 15),
  }),
  owing({
    number: "SUP/2026/0029",
    clientName: "GCB — DR Ouest",
    partyId: "gcb",
    issuedOn: day(5, 2),
    dueOn: day(6, 1),
    totalIncl: "2600000",
    lastRelanceAt: day(7, 28),
  }),
  owing({
    number: "SUP/2026/0038",
    clientName: "BALADNA ALGERIA",
    partyId: "baladna",
    issuedOn: day(6, 19),
    dueOn: day(7, 19),
    totalIncl: "1400000",
    lastRelanceAt: day(8, 11),
  }),
  owing({
    number: "SUP/2026/0041",
    clientName: "BALADNA ALGERIA",
    partyId: "baladna",
    issuedOn: day(8, 1),
    dueOn: day(8, 31),
    totalIncl: "661480",
  }),
  owing({
    number: "SUP/2026/0039",
    clientName: "SADEG",
    partyId: "sadeg",
    issuedOn: day(7, 28),
    dueOn: day(8, 27),
    totalIncl: "532520",
  }),
];

describe("the ageing report reproduces screen 20", () => {
  const ageing = ageingOf(LEDGER, TODAY);

  it("totals 10 834 000 across five invoices", () => {
    expect(ageing.total).toBe("10834000.00");
    expect(ageing.invoices).toBe(5);
  });

  it("matches all four bucket figures and their percentages", () => {
    expect(ageing.buckets.d0_30.amount).toBe("1194000.00");
    expect(ageing.buckets.d0_30.pct).toBe("11");
    expect(ageing.buckets.d31_60.amount).toBe("1400000.00");
    expect(ageing.buckets.d31_60.pct).toBe("13");
    expect(ageing.buckets.d61_90.amount).toBe("0.00");
    expect(ageing.buckets.d61_90.pct).toBe("0");
    expect(ageing.buckets.over90.amount).toBe("8240000.00");
    expect(ageing.buckets.over90.pct).toBe("76");
  });

  it("groups by client, biggest first, matching the bars", () => {
    expect(ageing.byClient.map((c) => [c.clientName, c.amount])).toEqual([
      ["URBACON (UCC)", "5640000.00"],
      ["GCB — DR Ouest", "2600000.00"],
      ["BALADNA ALGERIA", "2061480.00"],
      ["SADEG", "532520.00"],
    ]);
  });
});

describe("what the report leaves out", () => {
  it("leaves a settled invoice off entirely", () => {
    // Not "0 outstanding in the over-90 column" — finished. Including it would
    // make the invoice COUNT wrong, which is the number people scan first.
    const withPaid = ageingOf(
      [...LEDGER, owing({ totalIncl: "999999", paid: "999999", issuedOn: day(1, 1) })],
      TODAY,
    );
    expect(withPaid.invoices).toBe(5);
    expect(withPaid.total).toBe("10834000.00");
  });

  it("gives zeroes rather than NaN on an empty ledger", () => {
    // What a person sees on their first day using the system.
    const empty = ageingOf([], TODAY);
    expect(empty.total).toBe("0.00");
    expect(empty.buckets.over90.pct).toBe("0");
    expect(empty.byClient).toEqual([]);
  });

  it("counts a part payment against the balance, not the total", () => {
    expect(ageingOf([owing({ totalIncl: "1000000", paid: "400000" })], TODAY).total).toBe(
      "600000.00",
    );
  });
});

describe("the one invoice worth a phone call this morning", () => {
  it("names the big old untouched one, as the banner does", () => {
    const worst = mostNeglected(LEDGER, TODAY);
    // "No relance has been sent on SUP/2026/0034 for 34 days. It is 128 days
    // old and is the single largest amount owed to SUPSERV."
    expect(worst?.number).toBe("SUP/2026/0034");
    expect(worst?.ageDays).toBe(128);
    expect(worst?.silentDays).toBe(34);
    expect(worst?.isLargest).toBe(true);
  });

  it("leaves alone an invoice somebody chased yesterday, however old", () => {
    // Being old is not being neglected. Somebody is already on it, and a banner
    // telling them so is a banner they learn to ignore.
    expect(
      mostNeglected(
        [
          owing({
            issuedOn: day(1, 5),
            dueOn: day(2, 5),
            totalIncl: "9000000",
            lastRelanceAt: day(8, 17),
          }),
        ],
        TODAY,
      ),
    ).toBeNull();
  });

  it("prefers a lot of money left a fortnight over a little left a year", () => {
    // Amount × silence. That is where the money is, and both matter.
    const worst = mostNeglected(
      [
        owing({ number: "BIG", totalIncl: "5000000", dueOn: day(7, 20), lastRelanceAt: day(8, 1) }),
        owing({
          number: "SMALL",
          totalIncl: "80000",
          issuedOn: day(1, 1),
          dueOn: day(2, 1),
          lastRelanceAt: day(2, 2),
        }),
      ],
      TODAY,
    );
    expect(worst?.number).toBe("BIG");
  });

  it("says nothing when everything is either paid or not yet due", () => {
    expect(mostNeglected([owing({ dueOn: day(9, 30) })], TODAY)).toBeNull();
    expect(mostNeglected([owing({ totalIncl: "100", paid: "100" })], TODAY)).toBeNull();
    expect(mostNeglected([], TODAY)).toBeNull();
  });

  it("waits a fortnight before calling anything neglected", () => {
    const justChased = owing({
      dueOn: day(7, 1),
      lastRelanceAt: new Date(TODAY.getTime() - (SILENT_DAYS_BEFORE_NEGLECTED - 1) * 86_400_000),
    });
    expect(mostNeglected([justChased], TODAY)).toBeNull();
  });
});
