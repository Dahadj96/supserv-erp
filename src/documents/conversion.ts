/**
 * Screen 48 — turning a proforma into a facture.
 *
 * The banner at the top of that frame is the whole design:
 *
 *   "The proforma is never replaced. It stays on file, linked to the facture,
 *    and its number is not reused."
 *
 * A conversion CREATES a second document. It does not edit the first one into
 * something else. The proforma the client was sent keeps its number, its date
 * and its contents for as long as the company exists, because it is the thing
 * the client agreed to and somebody will ask what it said.
 *
 * ONE PLACE THIS DEPARTS FROM THE FRAME, deliberately.
 *
 * The frame's "What carries over" table shows `Number  PRO/2026/0089 →
 * SUP/2026/0043`, as though the facture's number were settled by pressing
 * Convert. It is not, and it must not be: `reserveNumber` runs inside the
 * transaction that ISSUES a document, so that the register is gapless and
 * chronological. If a number were handed out here, two people converting two
 * proformas on the same afternoon would both be shown SUP/2026/0043, and one of
 * them would be wrong — or worse, both would be right and the register would
 * have a hole where the abandoned draft used to be.
 *
 * So the row shows what the number WILL LOOK LIKE, from the series pattern, and
 * says it is not reserved yet. `peekNumber` exists for exactly this.
 */

/**
 * What may become what. Screen 48: "Quotation, pro forma, progress statement".
 *
 * `client_order` is the client saying yes — their bon de commande, or our
 * proforma back with "bon pour accord" on it. Recording it as a document made
 * FROM the offer is what every sales system does at "Confirm": the lines the
 * client accepted are copied once, under the client's own number, and the
 * deliveries and the factures hang off that rather than off an offer that may
 * have been revised twice since. It is also the only thing that moves an
 * enquiry to "won" (see `ORDER_KINDS` in domain/deal/deal.ts).
 */
export const CONVERSIONS: Record<string, string[]> = {
  quotation: ["proforma", "client_order", "invoice"],
  proforma: ["client_order", "invoice"],
  client_order: ["invoice"],
  situation: ["invoice"],
  delivery_note: ["invoice"],
};

export function mayConvert(from: string, to: string): boolean {
  return (CONVERSIONS[from] ?? []).includes(to);
}

export function targetsFor(from: string): string[] {
  return CONVERSIONS[from] ?? [];
}

/**
 * `unchanged` — it comes across as it stands.
 * `changes`   — it comes across altered, and the row says into what.
 * `toDecide`  — nobody has answered it yet, and Create is not the moment to
 *               find that out. These are screen 48's amber question marks.
 */
export type CarryState = "unchanged" | "changes" | "toDecide";

export type CarrySource = {
  kind: string;
  number: string | null;
  issuedOn: Date | null;
  /** Item lines that count towards the total. */
  lines: number;
  /** Lines marked as an option: shown to the client, excluded from the total. */
  options: number;
  /** Section headers — the frame's "3 lots". */
  sections: number;
  totalExcl: string;
  clientName: string;
};

export type Decisions = {
  invoiceDate: Date;
  dueDate: Date | null;
  /** null when nobody has said whether to generate one. */
  deliveryNote: "generate" | "skip" | null;
  deliveryDate: Date | null;
  paymentMethod: string | null;
  /** The source's payment method, if it carried one. */
  paymentMethodWas: string | null;
};

export type Mentions = {
  /** Compliance rows that pass. */
  passing: number;
  total: number;
  /** Rows that would refuse the issue. */
  blockers: number;
};

export type CarryRow = {
  key:
    | "lines"
    | "lots"
    | "options"
    | "client"
    | "kind"
    | "number"
    | "date"
    | "legalValue"
    | "mentions"
    | "deliveryNote"
    | "deliveryDate"
    | "paymentMethod";
  state: CarryState;
};

/**
 * The twelve rows of "What carries over", in the frame's order.
 *
 * Only the STATE is decided here. The wording is the page's, because half of
 * these rows read differently in French and all of them carry figures that
 * want formatting — and a domain module that returns display strings is a
 * domain module somebody has to change to fix a translation.
 */
export function carryOver(opts: {
  source: CarrySource;
  target: string;
  decisions: Decisions;
  mentions: Mentions;
}): CarryRow[] {
  const { source, decisions, mentions } = opts;

  return [
    { key: "lines", state: "unchanged" },
    // No sections at all is not a change worth an arrow; it is nothing.
    { key: "lots", state: "unchanged" },
    // Optional lines are shown to a client and excluded from the total. On an
    // invoice there is no such thing — every line is owed — so they come off.
    { key: "options", state: source.options > 0 ? "changes" : "unchanged" },
    { key: "client", state: "unchanged" },
    { key: "kind", state: "changes" },
    { key: "number", state: "changes" },
    {
      key: "date",
      state: sameDay(source.issuedOn, decisions.invoiceDate) ? "unchanged" : "changes",
    },
    { key: "legalValue", state: "changes" },
    {
      key: "mentions",
      // Complete is not a change — it is the state the document has to reach
      // before it may be issued at all, and the checks card says which rows.
      state: mentions.blockers > 0 ? "toDecide" : "changes",
    },
    { key: "deliveryNote", state: decisions.deliveryNote === null ? "toDecide" : "changes" },
    {
      key: "deliveryDate",
      // Only asked when a delivery note is actually being generated.
      state:
        decisions.deliveryNote === "generate" && decisions.deliveryDate === null
          ? "toDecide"
          : "unchanged",
    },
    {
      key: "paymentMethod",
      // The proforma's terms are a proposal. Somebody confirms them on the
      // document that will be enforced.
      state: decisions.paymentMethod === null ? "toDecide" : "unchanged",
    },
  ];
}

function sameDay(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

/** The rows nobody has answered. Create is disabled while any remain. */
export function undecided(rows: CarryRow[]): CarryRow[] {
  return rows.filter((row) => row.state === "toDecide");
}

/**
 * Screen 48's document chain, and what each step's number means.
 *
 * "The same chain applies whatever the client is. A devis can go straight to a
 * facture, a proforma can be skipped, a situation replaces the facture on works
 * — the steps are configurable, the numbering rules are not."
 */
export const CHAIN = [
  "quotation",
  "proforma",
  "client_order",
  "delivery_note",
  "invoice",
  "payment",
  "credit_note",
] as const;
export type ChainStep = (typeof CHAIN)[number];

export type ChainState = "done" | "current" | "planned" | "notNeeded";

/**
 * Where the chain stands.
 *
 * `planned` and `notNeeded` are different answers and the frame draws them
 * differently: a delivery note that is about to be generated is amber, and a
 * credit note that may never be needed is grey. Collapsing them would put a
 * credit note in front of somebody as though it were a step they had missed.
 */
export function chainOf(opts: {
  present: Partial<Record<ChainStep, string | null>>;
  target: string;
  generating: ChainStep[];
}): { step: ChainStep; number: string | null; state: ChainState }[] {
  return CHAIN.map((step) => {
    const number = opts.present[step] ?? null;
    if (number) return { step, number, state: "done" as ChainState };
    if (step === opts.target) return { step, number: null, state: "current" as ChainState };
    if (opts.generating.includes(step)) {
      return { step, number: null, state: "planned" as ChainState };
    }
    return { step, number: null, state: "notNeeded" as ChainState };
  });
}
