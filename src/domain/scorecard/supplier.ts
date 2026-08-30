/**
 * Screen 23 — the supplier scorecard.
 *
 * NOT ONE NEW COLUMN. Every figure on this screen is arithmetic over rows that
 * already exist: `sourcing_response` holds who was asked and whether they
 * answered, `sourcing_line` holds what they said a price was, `price_quote`
 * holds what we ended up paying, and the deal's outcome says whether the offer
 * built on their price was won.
 *
 * That is the whole reason a scorecard is worth having rather than a field
 * called `rating` that somebody sets once and never revisits. A supplier who
 * stopped replying in March shows it here in April, without anybody noticing
 * and going back to edit anything.
 *
 * This file is the arithmetic, pure. `store.ts` fetches the rows.
 */

export type ResponseFact = {
  responseId: string;
  requestRef: string;
  dealRef: string | null;
  /** When the message went out. Null means the request was never sent. */
  askedAt: Date | null;
  /** When they answered. Null means they did not. */
  repliedAt: Date | null;
  status: string;
  /** Lines we asked them about. */
  lines: number;
  /** Whether the offer built from this enquiry was won. Null = still open. */
  won: boolean | null;
  /** Whether any of their prices was actually used on the offer. */
  used: boolean;
  /** Whether we walked away from the enquiry entirely. */
  weNoBid: boolean;
};

export const OUTCOMES = [
  "usedInOffer",
  "offerWon",
  "offerLost",
  "notBestPrice",
  "noReply",
  "bounced",
  "declined",
  "weNoBid",
  "waiting",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/**
 * BOUNCED IS NOT SILENCE, and this is the third place in the system that says
 * so. Screen 67 puts it plainly: a bounced address has never replied because
 * the message never arrived, and counting it as a slow supplier is how somebody
 * quietly drops out of every comparison for a year.
 */
export function outcomeOf(fact: ResponseFact): Outcome {
  if (fact.status === "bounced") return "bounced";
  if (fact.status === "declined") return "declined";
  if (fact.status === "asked" && !fact.repliedAt) return "waiting";
  if (fact.status === "no_reply") return "noReply";
  if (fact.weNoBid) return "weNoBid";
  if (!fact.used) return "notBestPrice";
  if (fact.won === true) return "offerWon";
  if (fact.won === false) return "offerLost";
  return "usedInOffer";
}

export type Scorecard = {
  /** Requests actually sent to them, minus the ones that bounced. */
  asked: number;
  replied: number;
  /** Whole percent, floored. Null when we have never reached them. */
  replyRate: number | null;
  /** Bounced messages, kept out of the reply rate entirely. */
  bounced: number;
  /** Mean days from asked to replied, one decimal. Null with no replies. */
  turnaroundDays: number | null;
  wonWithTheirPrice: number;
  /** Decided enquiries where one of their prices was used. */
  offersWithTheirPrice: number;
  winRate: number | null;
  lastAskedAt: Date | null;
  lastAskedRef: string | null;
};

const DAY = 86_400_000;

export function scorecard(facts: ResponseFact[]): Scorecard {
  /**
   * A bounce is excluded from the denominator, not counted as a failure to
   * reply. Ten bounced messages to a dead address would otherwise read as a
   * nine per cent reply rate and condemn a supplier for our own stale contact.
   */
  const reachable = facts.filter((f) => f.askedAt !== null && f.status !== "bounced");
  const replied = reachable.filter((f) => f.repliedAt !== null);

  const turnarounds = replied
    .map((f) => (f.repliedAt as Date).getTime() - (f.askedAt as Date).getTime())
    .filter((ms) => ms >= 0);

  const withPrice = facts.filter((f) => f.used);
  const won = withPrice.filter((f) => f.won === true);
  /** Only decided ones. An open enquiry is not a loss. */
  const decided = withPrice.filter((f) => f.won !== null);

  const sent = facts.filter((f) => f.askedAt !== null);
  const last = sent.reduce<ResponseFact | null>(
    (worst, f) =>
      !worst || (f.askedAt as Date).getTime() > (worst.askedAt as Date).getTime() ? f : worst,
    null,
  );

  return {
    asked: reachable.length,
    replied: replied.length,
    replyRate:
      reachable.length === 0 ? null : Math.floor((replied.length / reachable.length) * 100),
    bounced: facts.filter((f) => f.status === "bounced").length,
    turnaroundDays:
      turnarounds.length === 0
        ? null
        : Math.round((turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length / DAY) * 10) / 10,
    wonWithTheirPrice: won.length,
    offersWithTheirPrice: decided.length,
    winRate: decided.length === 0 ? null : Math.floor((won.length / decided.length) * 100),
    lastAskedAt: last?.askedAt ?? null,
    lastAskedRef: last?.dealRef ?? last?.requestRef ?? null,
  };
}

/* ------------------------------------------------------------ price history */

export type QuoteFact = {
  reference: string | null;
  designation: string | null;
  quotedAt: Date;
  unitPrice: string;
};

export type PriceRow = {
  reference: string | null;
  designation: string | null;
  lastQuotedAt: Date;
  unitPrice: string;
  previous: string | null;
  /** Percent, one decimal, positive when it went up. Null with no previous. */
  changePct: number | null;
  timesQuoted: number;
};

/**
 * The last price we were quoted per article, and the one before it.
 *
 * Grouped by the supplier's own reference where there is one and by designation
 * where there is not — because a supplier who renames "Vanne papillon DN80"
 * halfway through the year has not introduced a second article, and a history
 * that split it in two would show a first-ever quote every time.
 */
export function priceHistory(quotes: QuoteFact[]): PriceRow[] {
  const groups = new Map<string, QuoteFact[]>();
  for (const quote of quotes) {
    const key = (quote.reference?.trim() || quote.designation?.trim() || "").toLowerCase();
    if (!key) continue;
    const held = groups.get(key);
    if (held) held.push(quote);
    else groups.set(key, [quote]);
  }

  const rows: PriceRow[] = [];
  for (const group of groups.values()) {
    const sorted = group.slice().sort((a, b) => b.quotedAt.getTime() - a.quotedAt.getTime());
    const latest = sorted[0] as QuoteFact;
    const previous = sorted[1] ?? null;

    const change =
      previous && Number(previous.unitPrice) !== 0
        ? Math.round(
            ((Number(latest.unitPrice) - Number(previous.unitPrice)) / Number(previous.unitPrice)) *
              1000,
          ) / 10
        : null;

    rows.push({
      reference: latest.reference,
      designation: latest.designation,
      lastQuotedAt: latest.quotedAt,
      unitPrice: latest.unitPrice,
      previous: previous?.unitPrice ?? null,
      changePct: change,
      timesQuoted: group.length,
    });
  }

  return rows.sort((a, b) => b.lastQuotedAt.getTime() - a.lastQuotedAt.getTime());
}

/* --------------------------------------------------------- price position */

export type LinePrices = { dealLineId: string; byParty: Record<string, string> };

export type PricePosition = {
  /** Lines where this supplier was the cheapest of those who quoted. */
  best: number;
  /** Lines where at least two suppliers quoted, so a comparison exists. */
  compared: number;
};

/**
 * "Best on 11 of 19."
 *
 * Only lines where somebody ELSE also quoted are counted. Being the cheapest of
 * one is not a price position, and counting it would give a sole supplier a
 * perfect record for never having been compared with anybody.
 */
export function pricePosition(lines: LinePrices[], partyId: string): PricePosition {
  let best = 0;
  let compared = 0;

  for (const line of lines) {
    const prices = Object.entries(line.byParty).filter(([, value]) => Number(value) > 0);
    if (prices.length < 2) continue;

    const mine = line.byParty[partyId];
    if (mine === undefined || Number(mine) <= 0) continue;

    compared++;
    const lowest = Math.min(...prices.map(([, value]) => Number(value)));
    // `<=`, not `<`: two suppliers at the same price are both the best price,
    // and calling neither of them best would be arithmetic nobody could defend.
    if (Number(mine) <= lowest) best++;
  }

  return { best, compared };
}
