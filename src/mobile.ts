/**
 * Screen 86 — "On the phone".
 *
 * A reference screen, not a route. It answers one question and then governs
 * every screen built afterwards: what is a phone actually FOR here?
 *
 * The answer on the frame is four things, and the reason is in its own caption:
 * "Eighty-five screens are 1440 wide. These four are 390." A phone is better at
 * being in the room — a camera in a shop, a price at a counter, a signature on
 * a site, a yes in a car. It is worse at fourteen lines of pricing, a
 * comparison of three suppliers, a cahier des charges of thirty-eight pages.
 * Shrinking those onto a phone produces something nobody uses twice.
 *
 * So the rule, and it is a rule rather than a preference:
 *
 *   CAPTURE AND APPROVE ON THE PHONE. BUILD AND DECIDE ON THE LAPTOP.
 *   Same data, same records, same permissions — one system, two shapes.
 *
 * This file is that rule as data, so a later screen cannot quietly become the
 * fifth phone screen without somebody adding a line here and a person reading
 * it. `tests/unit/mobile.test.ts` checks the list against the routes that
 * exist.
 */

export type PhoneJob = {
  key: string;
  /** The Figma frame this comes from, so the claim can be checked. */
  screen: number;
  href: string;
  /** Whether the route exists today. A phone bar that links to nothing is worse
   *  than a phone bar with three buttons. */
  built: boolean;
  /** Which phase brings it, when it is not built. Null when it is. */
  phase: number | null;
};

export const PHONE_JOBS: PhoneJob[] = [
  // 1 — In a shop, photographing a product. The one thing a phone does that a
  // laptop cannot at all. Works with no signal; sends when the network returns.
  { key: "capture", screen: 61, href: "/capture", built: true, phase: null },

  // 2 — At the counter, writing down a price. No email, no proforma, just a man
  // and a number. The price is marked VERBAL and stays unconfirmed until a
  // document backs it — LAW 2, on a phone.
  { key: "price", screen: 74, href: "/prices/new", built: false, phase: 4 },

  // 3 — Approving from anywhere. Approving is a decision, not data entry, which
  // is exactly why it fits on a phone and building an offer does not.
  { key: "approve", screen: 65, href: "/approvals", built: false, phase: 6 },

  // 4 — Reading, not writing. Today, and a tap that dials a client. Everything
  // else on a phone is read-only, on purpose.
  { key: "today", screen: 55, href: "/today", built: false, phase: 6 },
];

/** The width the four are drawn at. The other eighty-five are 1440. */
export const PHONE_WIDTH = 390;

/** What the bottom bar shows: the built ones, in the frame's order. */
export function phoneBar(): PhoneJob[] {
  return PHONE_JOBS.filter((job) => job.built);
}

/**
 * Is this route one of the four?
 *
 * Used to decide whether a page gets the phone treatment or the "open this on a
 * laptop" note. A page that is neither — most of them — is still reachable on a
 * phone and still readable; it simply is not pretending to be designed for one.
 */
export function isPhoneRoute(pathname: string): boolean {
  const path = pathname.replace(/^\/(fr|en)(?=\/|$)/, "") || "/";
  return PHONE_JOBS.some((job) => path === job.href || path.startsWith(`${job.href}/`));
}
