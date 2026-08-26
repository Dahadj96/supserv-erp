import { describe, expect, it } from "vitest";
import type { Owing } from "@/domain/money/ageing";
import { type InvoiceFacts, isOwing, over90, paidStateOf } from "@/domain/money/invoices";

/**
 * Screen 17's Status column, with the frame's own seven rows.
 *
 * | Number         | Client            | Total     | Paid    | Issued | Age  | Status       |
 * | SUP/2026/0034  | URBACON (UCC)     | 5 640 000 |       0 | 12 Apr | 128d | Issued       |
 * | SUP/2026/0029  | GCB — DR Ouest    | 2 600 000 |       0 | 02 May | 108d | Issued       |
 * | SUP/2026/0038  | BALADNA ALGERIA   | 1 400 000 |       0 | 19 Jun |  60d | Issued       |
 * | SUP/2026/0040  | SADEG             |   856 800 | 856 800 | 03 Jul |  46d | Paid         |
 * | SUP/2026/0041  | BALADNA ALGERIA   | 1 061 480 | 400 000 | 01 Aug |  17d | Partly paid  |
 * | SUP/2026/0042  | SADEG             | 2 189 600 |       0 |    —   | draft| Draft        |
 * | PRO/2026/0088  | GROUPEMENT TOUATG | 1 901 620 |       — | 16 Aug |   2d | No legal value |
 *
 * Every age reconciles against 18 August 2026 and the ISSUE date, the same
 * clock screen 20's buckets use.
 *
 * TWO SLIPS IN THE MOCKUP, written down so nobody codes around them:
 *
 * 1. The filter chips read All 38, Pro forma 9, Draft 2, Issued 6, Partly paid
 *    2, Paid 19, **Issued 4** — "Issued" twice, with different counts, and the
 *    chips sum to 42 rather than 38. The footer meanwhile says "Showing 1–7 of
 *    7". The chips are illustrative; the code counts rows.
 * 2. Every "Paid" status on the frame is drawn as a status chip beside Draft
 *    and Issued, which invites storing all five in one column. Three of them
 *    are facts about the document and two are arithmetic over allocations that
 *    change without anybody touching it. They do not share a column here.
 */

const facts = (over: Partial<InvoiceFacts> = {}): InvoiceFacts => ({
  kind: "invoice",
  status: "issued",
  number: "SUP/2026/0034",
  totalIncl: "5640000",
  paid: "0",
  ...over,
});

describe("what the status column says", () => {
  it("reads the frame's seven rows off the allocations", () => {
    expect(paidStateOf(facts())).toBe("unpaid");
    expect(paidStateOf(facts({ totalIncl: "856800", paid: "856800" }))).toBe("paid");
    expect(paidStateOf(facts({ totalIncl: "1061480", paid: "400000" }))).toBe("partPaid");
    expect(paidStateOf(facts({ status: "draft", number: null, paid: "0" }))).toBe("draft");
    expect(paidStateOf(facts({ kind: "proforma", number: "PRO/2026/0088" }))).toBe("noLegalValue");
  });

  it("calls a proforma no legal value however much has been paid against it", () => {
    // Not a hypothetical: somebody pays against the proforma they were sent.
    // The money is real, the document still is not an invoice, and counting it
    // as owed would inflate every figure on screens 17 and 20.
    expect(paidStateOf(facts({ kind: "proforma", paid: "1901620", totalIncl: "1901620" }))).toBe(
      "noLegalValue",
    );
  });

  it("treats an unnumbered document as a draft whatever its status says", () => {
    // LAW 5 — the number IS the issue. A row claiming to be issued without one
    // is a row somebody's import wrote, not a document a client has seen.
    expect(paidStateOf(facts({ status: "issued", number: null }))).toBe("draft");
  });

  it("ignores a stored paid status in favour of the allocations", () => {
    // The whole reason the two do not share a column. If a status could
    // override the arithmetic, the arithmetic would stop being the answer.
    expect(paidStateOf(facts({ status: "paid", paid: "0" }))).toBe("unpaid");
    expect(paidStateOf(facts({ status: "part_paid", paid: "5640000" }))).toBe("paid");
  });

  it("counts an overpayment as paid rather than waiting for an exact match", () => {
    expect(paidStateOf(facts({ totalIncl: "1000", paid: "1000.80" }))).toBe("paid");
  });

  it("does not call a zero-total document paid", () => {
    // Nought against nought is not settled, it is empty.
    expect(paidStateOf(facts({ totalIncl: "0", paid: "0" }))).toBe("unpaid");
  });

  it("keeps a credited invoice out of what is owed", () => {
    expect(paidStateOf(facts({ status: "credited" }))).toBe("credited");
    expect(isOwing("credited")).toBe(false);
    expect(isOwing("writtenOff")).toBe(false);
    expect(isOwing("noLegalValue")).toBe(false);
    expect(isOwing("draft")).toBe(false);
    expect(isOwing("unpaid")).toBe(true);
    expect(isOwing("partPaid")).toBe(true);
  });
});

/**
 * The red banner: "2 invoices are past 90 days with URBACON and GCB, totalling
 * 8 240 000 DZD. No relance has been sent in 34 days."
 *
 * 8 240 000 = 5 640 000 + 2 600 000, which is exactly screen 20's over-90
 * bucket. The two screens read one ledger.
 */
const TODAY = new Date("2026-08-18T00:00:00Z");
const on = (iso: string) => new Date(`${iso}T00:00:00Z`);

const owing = (over: Partial<Owing> & { documentId: string }): Owing => ({
  number: "SUP/2026/0034",
  partyId: "urbacon",
  clientName: "URBACON (UCC)",
  issuedOn: on("2026-04-12"),
  dueOn: on("2026-05-12"),
  totalIncl: "5640000",
  paid: "0",
  currency: "DZD",
  lastRelanceAt: null,
  ...over,
});

const LEDGER: Owing[] = [
  owing({ documentId: "a", lastRelanceAt: on("2026-07-15") }),
  owing({
    documentId: "b",
    number: "SUP/2026/0029",
    partyId: "gcb",
    clientName: "GCB — DR Ouest",
    issuedOn: on("2026-05-02"),
    totalIncl: "2600000",
  }),
  // 60 days old — inside the bucket boundary, so not in the banner.
  owing({
    documentId: "c",
    number: "SUP/2026/0038",
    partyId: "baladna",
    clientName: "BALADNA ALGERIA",
    issuedOn: on("2026-06-19"),
    totalIncl: "1400000",
  }),
];

describe("the past-90-days banner", () => {
  it("reproduces the frame's sentence exactly", () => {
    const alert = over90(LEDGER, TODAY);
    expect(alert?.invoices).toBe(2);
    expect(alert?.amount).toBe("8240000.00");
    expect(alert?.clients).toEqual(["GCB — DR Ouest", "URBACON (UCC)"]);
    // 15 July to 18 August.
    expect(alert?.silentDays).toBe(34);
  });

  it("names the clients rather than counting them", () => {
    // "2 invoices past 90 days" is a number to scroll past. "URBACON and GCB"
    // is a name to telephone.
    expect(over90(LEDGER, TODAY)?.clients).toHaveLength(2);
  });

  it("answers with the most recent chase across the group", () => {
    // One of them chased yesterday is the honest answer to "has anybody done
    // anything about this", even if the other has been silent for months.
    const chasedYesterday = [
      LEDGER[0] as Owing,
      { ...(LEDGER[1] as Owing), lastRelanceAt: on("2026-08-17") },
    ];
    expect(over90(chasedYesterday, TODAY)?.silentDays).toBe(1);
  });

  it("says nobody has ever chased them rather than reporting nought days", () => {
    const untouched = LEDGER.map((o) => ({ ...o, lastRelanceAt: null }));
    expect(over90(untouched, TODAY)?.silentDays).toBeNull();
  });

  it("leaves a settled invoice out however old it is", () => {
    const settled = LEDGER.map((o) => ({ ...o, paid: o.totalIncl }));
    expect(over90(settled, TODAY)).toBeNull();
  });

  it("shows no banner when nothing is past ninety days", () => {
    expect(over90([LEDGER[2] as Owing], TODAY)).toBeNull();
  });
});
