/**
 * Screen 74 — "prices come from wherever you found them".
 *
 * The banner on the frame is the design: "A price does not have to come from an
 * email. A shop you visited, a phone call, a proforma someone handed you, or
 * your own costing all count — and each is recorded with where it came from."
 *
 * Half this company's buying happens over a counter in Adrar. A system that
 * only accepts prices from emails is a system people keep a notebook beside,
 * and the notebook is where the margin goes missing. So every source is
 * first-class, and the PROVENANCE travels with the number all the way onto the
 * offer.
 *
 * Nothing in this file promotes a price. A verbal price does not become firm
 * because a week passed or because somebody used it on an offer. Only attaching
 * evidence does that, and attaching evidence is something a person does.
 */

/** The five buttons on "Add a price". The fields change with the choice. */
export const PRICE_SOURCES = [
  "supplier_email",
  "supplier_proforma",
  "shop_visit",
  "phone",
  "internal_costing",
] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export function isPriceSource(value: string | undefined): value is PriceSource {
  return PRICE_SOURCES.includes((value ?? "") as PriceSource);
}

/**
 * How firm a price is. Screen 74's "Firm?" column.
 *
 * `internal` is its own answer rather than a kind of firm: our own costing is
 * neither a promise somebody made us nor a guess we heard — it is a number we
 * are responsible for, and on the offer it carries our margin rather than a
 * supplier's quote.
 */
export type Firmness = "written" | "verbal" | "internal";

export function firmnessOf(quote: { source: PriceSource; isVerbal: boolean }): Firmness {
  if (quote.source === "internal_costing") return "internal";
  return quote.isVerbal ? "verbal" : "written";
}

export type Quote = {
  id: string;
  dealLineId: string | null;
  itemId: string | null;
  /**
   * What the price was for, in words, as the line read when it was captured.
   *
   * The only thing left once somebody corrects a pasted line and the row it
   * pointed at is gone. A quote with `dealLineId: null` and a designation is
   * not an orphan — it is a price for an article on this enquiry that the line
   * table no longer lists in those words.
   */
  designation: string | null;
  source: PriceSource;
  supplierName: string | null;
  price: string;
  currency: string;
  isVerbal: boolean;
  capturedAt: Date;
  capturedPlace: string | null;
  validUntil: Date | null;
};

/**
 * The best price for a line, and why it is not simply the lowest number.
 *
 * Screen 74 says "best price per item is highlighted". Cheapest wins, but only
 * among prices that will still be valid when the client decides — a supplier
 * who is 3% cheaper on a price that expires next Tuesday is not cheaper, he is
 * a phone call you will have to make again under time pressure.
 *
 * When every price for a line will have expired, the cheapest is still shown.
 * Refusing to pick one would leave the line blank on the offer, which helps
 * nobody; the expiry is reported separately by `riskOf`.
 */
export function bestFor(quotes: Quote[], decidesOn: Date | null): Quote | null {
  if (quotes.length === 0) return null;

  const cheapest = (list: Quote[]) =>
    list.reduce((best, q) => (Number(q.price) < Number(best.price) ? q : best));

  if (!decidesOn) return cheapest(quotes);

  const stillGood = quotes.filter((q) => !q.validUntil || q.validUntil >= decidesOn);
  return cheapest(stillGood.length > 0 ? stillGood : quotes);
}

/** Screen 74's Coverage card, computed. Nothing here is stored. */
export type Coverage = {
  items: number;
  withAnyPrice: number;
  withTwoOrMore: number;
  noPriceYet: number;
  pricedByUs: number;
  /** Lines whose ONLY prices are verbal. The risky ones. */
  verbalOnly: number;
};

export function coverageOf(lineIds: string[], quotes: Quote[]): Coverage {
  const byLine = new Map<string, Quote[]>();
  for (const id of lineIds) byLine.set(id, []);
  for (const quote of quotes) {
    if (!quote.dealLineId) continue;
    byLine.get(quote.dealLineId)?.push(quote);
  }

  let withAnyPrice = 0;
  let withTwoOrMore = 0;
  let pricedByUs = 0;
  let verbalOnly = 0;

  for (const list of byLine.values()) {
    if (list.length === 0) continue;
    withAnyPrice += 1;
    if (list.length >= 2) withTwoOrMore += 1;
    if (list.some((q) => q.source === "internal_costing")) pricedByUs += 1;
    // "Verbal only" means there is nothing written to fall back on. A line with
    // one verbal and one written price is not at risk — it has a document.
    if (list.every((q) => firmnessOf(q) === "verbal")) verbalOnly += 1;
  }

  return {
    items: lineIds.length,
    withAnyPrice,
    withTwoOrMore,
    noPriceYet: lineIds.length - withAnyPrice,
    pricedByUs,
    verbalOnly,
  };
}

/**
 * Screen 74's "What a verbal price costs you".
 *
 * The frame spells out the case: "Three of your prices are verbal and hold for
 * a week. If Urbacon decides in September, none of them is binding. The offer
 * will still go out — but the risk is recorded against those lines rather than
 * discovered later."
 *
 * That last sentence is the whole feature. Nothing here blocks anything. It
 * computes what is already true and puts it on the screen BEFORE the offer goes
 * out, instead of leaving it to be found in September when the supplier says
 * the price has moved.
 */
export type PriceRisk = {
  /** Lines whose chosen price is written or a proforma. */
  firm: number;
  /** Lines whose chosen price is somebody's word. */
  verbal: number;
  /**
   * Lines whose chosen price runs out before the client is expected to decide.
   * The one that actually costs money, and the one nobody notices.
   */
  expiresFirst: number;
  /** When we think they will decide, and where that date came from. */
  decidesOn: Date | null;
  decidesOnBasis: "clientDeadline" | "none";
};

/**
 * How long after the client's own deadline a decision typically lands.
 *
 * Public buyers in Algeria open the envelopes on the deadline and answer some
 * weeks later. Thirty days is the number this office has been using in its
 * head; it is written here so it can be argued with, and so that the sentence
 * on screen says something specific rather than "prices may expire".
 *
 * It is NOT a rule and nothing is refused because of it. It only decides which
 * lines get counted in `expiresFirst`.
 */
export const DAYS_UNTIL_A_CLIENT_DECIDES = 30;

export function riskOf(opts: {
  lineIds: string[];
  quotes: Quote[];
  clientDeadline: Date | null;
}): PriceRisk {
  const decidesOn = opts.clientDeadline
    ? new Date(opts.clientDeadline.getTime() + DAYS_UNTIL_A_CLIENT_DECIDES * 86_400_000)
    : null;

  const byLine = new Map<string, Quote[]>();
  for (const id of opts.lineIds) byLine.set(id, []);
  for (const quote of opts.quotes) {
    if (!quote.dealLineId) continue;
    byLine.get(quote.dealLineId)?.push(quote);
  }

  let firm = 0;
  let verbal = 0;
  let expiresFirst = 0;

  for (const list of byLine.values()) {
    const chosen = bestFor(list, decidesOn);
    if (!chosen) continue;

    if (firmnessOf(chosen) === "verbal") verbal += 1;
    else firm += 1;

    if (decidesOn && chosen.validUntil && chosen.validUntil < decidesOn) expiresFirst += 1;
  }

  return {
    firm,
    verbal,
    expiresFirst,
    decidesOn,
    decidesOnBasis: opts.clientDeadline ? "clientDeadline" : "none",
  };
}
