/**
 * Screen 19 — "Rules that apply".
 *
 * The frame shows four rows and states each one as a fact: cash attracts the
 * droit de timbre, a transfer does not, foreign currency requires
 * domiciliation, a partial payment is allowed. Three of those are claims about
 * Algerian law, and screen 69 forbids this software from making claims about
 * Algerian law on its own authority:
 *
 *   "The software enforces these rules. It does not assert that they are the
 *   law. Each one names its source and the person who confirmed it — and until
 *   someone does, it is marked unconfirmed and enforced as a warning only."
 *
 * So every row here carries a BASIS, and the basis decides what the screen is
 * allowed to say:
 *
 *   profile    — written down in the compliance profile. Confirmed by a person
 *                or by a decree → stated. Not yet → shown as unconfirmed.
 *   structural — true because of how this system is built, not because anybody
 *                said so. "Partial payments are tracked" is structural: the
 *                schema has no `paid_amount` column to round off.
 *   unwritten  — the frame asserts it and NOBODY HAS WRITTEN IT DOWN. It is
 *                shown, because a person recording a foreign-currency receipt
 *                should be prompted to check, and it is shown as a question
 *                rather than a rule, with the route to make it a real one.
 *
 * Domiciliation is the `unwritten` case, and deliberately not quietly promoted
 * to a rule: inventing a confirmable rule out of a mockup is exactly the thing
 * screen 69 exists to stop. `docs/DECISIONS/2026-08-26-domiciliation.md` hands
 * it to the accountant.
 */

/** virement | cheque | especes | traite | compensation. */
export const INSTRUMENTS = ["virement", "cheque", "especes", "traite", "compensation"] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

export function isInstrument(value: string): value is Instrument {
  return (INSTRUMENTS as readonly string[]).includes(value);
}

export type Basis = "profile" | "structural" | "unwritten";

/**
 * What the screen may say about one row.
 *
 * `applies`      — it is a rule, it is settled, and this payment triggers it.
 * `doesNotApply` — it is a rule, it is settled, and this payment does not.
 * `check`        — nobody has confirmed it. The screen asks; it does not assert.
 * `tracked`      — structural. The system does this and cannot not do it.
 */
export type RuleState = "applies" | "doesNotApply" | "check" | "tracked";

export type PaymentRule = {
  /** messages key under `payments.rule` */
  key: "cashTimbre" | "transferNoTimbre" | "foreignCurrency" | "partial";
  basis: Basis;
  state: RuleState;
  /** The compliance-profile code this row rests on, when it rests on one. */
  ruleCode: string | null;
  /** Where a person goes to settle it. Null when there is nothing to settle. */
  fixRoute: string | null;
  /** True when this row is about the payment being entered right now. */
  active: boolean;
};

export type PaymentShape = {
  method: Instrument;
  currency: string;
  /** Does this payment leave a balance on the invoice it settles? */
  partial: boolean;
  /** Rule codes the compliance profile records as confirmed. */
  confirmed: ReadonlySet<string>;
};

export const STAMP_DUTY_RULE = "invoice.stampDutyThreshold";

/**
 * The four rows, always all four.
 *
 * All of them, every time, because the card answers "what do I need to know
 * about settling an invoice here" and not only "what did I just tick". A person
 * choosing `especes` should be able to see, without changing anything, that a
 * transfer would have avoided the question entirely.
 */
export function rulesFor(shape: PaymentShape): PaymentRule[] {
  const cash = shape.method === "especes";
  const transfer = shape.method === "virement";
  const foreign = shape.currency.toUpperCase() !== "DZD";
  const timbreSettled = shape.confirmed.has(STAMP_DUTY_RULE);

  return [
    {
      key: "cashTimbre",
      basis: "profile",
      // Unconfirmed means unconfirmed even when the payment is not cash. The
      // row cannot honestly read "does not apply" on a rule whose threshold
      // and rate nobody has told us.
      state: !timbreSettled ? "check" : cash ? "applies" : "doesNotApply",
      ruleCode: STAMP_DUTY_RULE,
      fixRoute: "/settings/compliance",
      active: cash,
    },
    {
      key: "transferNoTimbre",
      basis: "profile",
      state: !timbreSettled ? "check" : transfer ? "applies" : "doesNotApply",
      ruleCode: STAMP_DUTY_RULE,
      fixRoute: "/settings/compliance",
      active: transfer,
    },
    {
      key: "foreignCurrency",
      basis: "unwritten",
      state: "check",
      ruleCode: null,
      fixRoute: "/settings/compliance",
      active: foreign,
    },
    {
      key: "partial",
      basis: "structural",
      // Not a permission granted by a rule — a fact about the schema. A payment
      // is its own row and its allocation is separate, so a part payment is the
      // ordinary case and the balance falls out of arithmetic.
      state: "tracked",
      ruleCode: null,
      fixRoute: null,
      active: shape.partial,
    },
  ];
}

/**
 * The rows a person should read before pressing Record — the ones this payment
 * actually touches that are not simply settled.
 *
 * Used for the one-line warning above the button. Structural rows never appear:
 * "the system will track the balance" is reassurance, not a caution, and a
 * warning strip that includes reassurance stops being read.
 */
export function toCheck(rules: PaymentRule[]): PaymentRule[] {
  return rules.filter((rule) => rule.active && rule.state === "check");
}
