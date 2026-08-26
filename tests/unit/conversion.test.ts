import { describe, expect, it } from "vitest";
import {
  type CarrySource,
  carryOver,
  chainOf,
  type Decisions,
  mayConvert,
  targetsFor,
  undecided,
} from "@/documents/conversion";

/**
 * Screen 48 — Convert PRO/2026/0089 into a facture.
 *
 * The frame's "What carries over" table, twelve rows:
 *
 *   ✓ Lines and prices     24 lines, 1 384 858 excl. VAT  → unchanged
 *   ✓ Lots and subtotals   3 lots                         → unchanged
 *   → Optional lines       2 lines not counted            → removed
 *   ✓ Client and identifiers                              → unchanged
 *   → Document type        Pro forma invoice              → Invoice
 *   → Number               PRO/2026/0089                  → SUP/2026/0043
 *   → Date                 12 Aug 2026                    → 18 Aug 2026
 *   → Legal value          None                           → Accounting document
 *   → Mandatory mentions   Partial                        → Complete, 11 of 11
 *   ? Delivery note        —                              → to generate
 *   ? Delivery date        —                              → to enter
 *   ? Payment method       Bank transfer, 30 days         → confirm
 *
 * ONE ROW IS BUILT AGAINST THE FRAME ON PURPOSE. The Number row shows
 * "SUP/2026/0043" as though pressing Convert settled it. It does not:
 * `reserveNumber` runs inside the transaction that ISSUES a document, so that
 * the register is gapless. Handing a number out here would show two people
 * converting on the same afternoon the same next number, and an abandoned
 * draft would leave a hole in a sequence that may not have one. The screen
 * shows what the number will LOOK like and says it is not reserved.
 */

const on = (iso: string) => new Date(`${iso}T00:00:00Z`);

const source = (over: Partial<CarrySource> = {}): CarrySource => ({
  kind: "proforma",
  number: "PRO/2026/0089",
  issuedOn: on("2026-08-12"),
  lines: 24,
  options: 2,
  sections: 3,
  totalExcl: "1384858.00",
  clientName: "BALADNA ALGERIA",
  ...over,
});

const decisions = (over: Partial<Decisions> = {}): Decisions => ({
  invoiceDate: on("2026-08-18"),
  dueDate: on("2026-09-17"),
  deliveryNote: null,
  deliveryDate: null,
  paymentMethod: null,
  paymentMethodWas: "Bank transfer, 30 days",
  ...over,
});

const rows = (s = source(), d = decisions(), blockers = 0) =>
  carryOver({
    source: s,
    target: "invoice",
    decisions: d,
    mentions: { passing: 11, total: 11, blockers },
  });

const stateOf = (key: string, ...args: Parameters<typeof rows>) =>
  rows(...args).find((row) => row.key === key)?.state;

describe("what may become what", () => {
  it("allows the three the frame lists and refuses the rest", () => {
    expect(mayConvert("proforma", "invoice")).toBe(true);
    expect(mayConvert("quotation", "invoice")).toBe(true);
    expect(mayConvert("situation", "invoice")).toBe(true);
    expect(mayConvert("invoice", "proforma")).toBe(false);
    // Backwards is the dangerous one: it would let an issued facture be turned
    // into a document with no legal value.
    expect(mayConvert("invoice", "quotation")).toBe(false);
    expect(mayConvert("credit_note", "invoice")).toBe(false);
  });

  it("says what a document may become", () => {
    expect(targetsFor("proforma")).toEqual(["invoice"]);
    expect(targetsFor("nonsense")).toEqual([]);
  });
});

describe("what carries over", () => {
  it("returns the frame's twelve rows in the frame's order", () => {
    expect(rows().map((r) => r.key)).toEqual([
      "lines",
      "lots",
      "options",
      "client",
      "kind",
      "number",
      "date",
      "legalValue",
      "mentions",
      "deliveryNote",
      "deliveryDate",
      "paymentMethod",
    ]);
  });

  it("carries the lines, the lots and the client across untouched", () => {
    expect(stateOf("lines")).toBe("unchanged");
    expect(stateOf("lots")).toBe("unchanged");
    expect(stateOf("client")).toBe("unchanged");
  });

  it("drops optional lines, because an invoice has no such thing", () => {
    // An option is printed so a client can see what they did not buy. Every
    // line on a facture is owed.
    expect(stateOf("options")).toBe("changes");
    expect(stateOf("options", source({ options: 0 }))).toBe("unchanged");
  });

  it("changes the type, the number and the legal value every time", () => {
    expect(stateOf("kind")).toBe("changes");
    expect(stateOf("number")).toBe("changes");
    expect(stateOf("legalValue")).toBe("changes");
  });

  it("leaves the date alone when the facture carries the proforma's own date", () => {
    expect(stateOf("date")).toBe("changes");
    expect(stateOf("date", source(), decisions({ invoiceDate: on("2026-08-12") }))).toBe(
      "unchanged",
    );
  });

  it("holds the mentions open while a rule still refuses", () => {
    // Complete is not a change; it is the state the document has to reach
    // before it may be issued at all.
    expect(stateOf("mentions", source(), decisions(), 0)).toBe("changes");
    expect(stateOf("mentions", source(), decisions(), 1)).toBe("toDecide");
  });

  it("asks only the questions that can be answered yet", () => {
    /**
     * The frame marks three rows amber at once — delivery note, delivery date,
     * payment method — while its own Three decisions card has already answered
     * the first ("Generate BL-2026-0131 at the same time"). Its amber means
     * "open item", covering both a decision nobody has taken and an action
     * nobody has done.
     *
     * Split here, because they are answered in an order. Until somebody says
     * whether a delivery note is being generated, its DATE is not a question —
     * it is a question about a thing that may not exist. Asking both at once
     * puts a field in front of somebody that half the time means nothing.
     */
    expect(undecided(rows()).map((r) => r.key)).toEqual(["deliveryNote", "paymentMethod"]);
  });

  it("stops asking for a delivery date once nobody is generating a note", () => {
    const answered = decisions({ deliveryNote: "skip", paymentMethod: "Virement 30 j" });
    expect(undecided(rows(source(), answered))).toEqual([]);
  });

  it("keeps asking for the date when a note is being generated and none is set", () => {
    const generating = decisions({ deliveryNote: "generate", paymentMethod: "Virement 30 j" });
    expect(undecided(rows(source(), generating)).map((r) => r.key)).toEqual(["deliveryDate"]);
  });

  it("treats the proforma's terms as a proposal somebody confirms", () => {
    // Carrying "Bank transfer, 30 days" silently onto the document that will
    // actually be enforced is how a client ends up held to terms nobody read.
    expect(stateOf("paymentMethod")).toBe("toDecide");
    expect(stateOf("paymentMethod", source(), decisions({ paymentMethod: "Virement 30 j" }))).toBe(
      "unchanged",
    );
  });
});

describe("the document chain", () => {
  const chain = chainOf({
    present: { quotation: "DEV/2026/0117", proforma: "PRO/2026/0089" },
    target: "invoice",
    generating: ["delivery_note"],
  });
  const at = (step: string) => chain.find((s) => s.step === step);

  it("marks what exists, what is being made, and what is merely planned", () => {
    expect(at("quotation")?.state).toBe("done");
    expect(at("proforma")?.state).toBe("done");
    expect(at("invoice")?.state).toBe("current");
    expect(at("delivery_note")?.state).toBe("planned");
  });

  it("keeps a credit note grey rather than amber", () => {
    // Planned and not-needed are different answers. A credit note shown as a
    // step somebody has missed is a credit note somebody creates.
    expect(at("credit_note")?.state).toBe("notNeeded");
    expect(at("payment")?.state).toBe("notNeeded");
  });

  it("keeps every step's own number", () => {
    expect(at("quotation")?.number).toBe("DEV/2026/0117");
    expect(at("proforma")?.number).toBe("PRO/2026/0089");
    // And the invoice has none yet, because it does not exist yet.
    expect(at("invoice")?.number).toBeNull();
  });
});
