import { normaliseWording } from "../designation";
import { AUTO_CREATE_FLOOR } from "./rails";

/**
 * Screen 38 — the routing rules. Applied in order, first match wins.
 *
 * The matcher is a structured object, never a string to evaluate. These rules
 * are edited from a settings screen by a person, and a rule engine that runs
 * arbitrary expressions from the database is a way to execute code by editing a
 * row. Every condition below is a named field with a known meaning.
 */

/** What a matched rule produces. `needsReview` is a real outcome, not a failure. */
export const ROUTED_TO = [
  "candidate",
  "enquiry",
  "tender",
  "supplierQuote",
  "payment",
  "needsReview",
] as const;
export type RoutedTo = (typeof ROUTED_TO)[number];

export type RuleMode = "auto" | "suggest" | "manual";

export type Matcher = {
  /** Any one of these in the subject is a hit. Matched after normalisation. */
  subjectContains?: string[];
  bodyContains?: string[];
  /** The sender's address resolves to a company we know. */
  senderIsKnownCompany?: boolean;
  /** ...and that company has the supplier role. */
  senderIsKnownSupplier?: boolean;
  /** An attachment the classifier thinks is of this kind. */
  attachmentLooksLike?: string;
  /** The body contains something shaped like a price in DZD or EUR. */
  bodyContainsPrice?: boolean;
};

export type RoutingRule = {
  id: string;
  position: number;
  matcher: Matcher;
  creates: RoutedTo;
  mode: RuleMode;
  enabled: boolean;
  labelKey: string;
  actionKey: string;
};

/** Everything the router is allowed to know about a captured message. */
export type RoutableMessage = {
  subject: string | null;
  bodyText: string | null;
  senderIsKnownCompany: boolean;
  senderIsKnownSupplier: boolean;
  attachmentKinds: string[];
};

export type RoutingDecision = {
  rule: RoutingRule | null;
  creates: RoutedTo;
  /** What the router will actually do, after the rails have had their say. */
  mode: RuleMode;
  confidence: number;
  /** Which conditions fired. The screen shows this; so does the audit entry. */
  matched: (keyof Matcher)[];
  /** Set when a rule said `auto` and the confidence floor overruled it. */
  downgraded: boolean;
};

/**
 * A price in the body: 1 250 000,00 DA / 45.000 DZD / € 12 300.
 *
 * Deliberately not clever. A false positive sends a supplier's email to
 * "supplier quote" instead of "needs review", which a person fixes in one
 * click. A false negative loses the quote in a pile, which nobody fixes.
 */
// `\b` is useless next to € and $ — neither is a word character, so a boundary
// never exists before one. Symbols and words are therefore matched separately.
const CURRENCY = "(?:€|\\$|\\b(?:da|dzd|eur|usd)\\b)";
const PRICE = new RegExp(`(?:\\d[\\d\\s.,]{2,}\\s*${CURRENCY})|(?:${CURRENCY}\\s*\\d)`, "i");

export function bodyLooksLikeItHasAPrice(body: string | null): boolean {
  return body ? PRICE.test(body) : false;
}

/** Accents and case are noise here for the same reason they are in search. */
function contains(haystack: string | null, needles: string[]): boolean {
  if (!haystack) return false;
  const hay = normaliseWording(haystack);
  return needles.some((n) => hay.includes(normaliseWording(n)));
}

/**
 * How sure the router is.
 *
 * Confidence is the share of a rule's conditions that fired, weighted so that
 * knowing WHO sent it counts for more than a keyword — "facture" in a subject
 * line means much less than the address belonging to a supplier we buy from.
 */
const WEIGHTS: Record<keyof Matcher, number> = {
  senderIsKnownSupplier: 3,
  senderIsKnownCompany: 2,
  attachmentLooksLike: 2,
  subjectContains: 2,
  bodyContainsPrice: 1,
  bodyContains: 1,
};

function evaluate(
  rule: RoutingRule,
  message: RoutableMessage,
): { hit: boolean; confidence: number; matched: (keyof Matcher)[] } {
  const conditions = Object.keys(rule.matcher) as (keyof Matcher)[];

  // A rule with no conditions is the catch-all. It matches everything and is
  // certain about nothing, which is exactly what "Anything else" means.
  if (conditions.length === 0) return { hit: true, confidence: 0, matched: [] };

  const matched: (keyof Matcher)[] = [];
  for (const key of conditions) {
    if (test(key, rule.matcher, message)) matched.push(key);
  }

  // Every condition must fire. The weights decide how much the result is worth,
  // not whether it counts — a rule that fires on half its conditions is a rule
  // somebody wrote badly, not a 50% match.
  if (matched.length !== conditions.length) {
    return { hit: false, confidence: 0, matched };
  }

  const earned = matched.reduce((sum, key) => sum + WEIGHTS[key], 0);
  // Scaled against the strongest a rule of this size could be, so a two-signal
  // rule built on sender + attachment scores higher than one built on keywords.
  const ceiling = conditions.length * 3;
  return { hit: true, confidence: Math.min(1, earned / ceiling + 0.34), matched };
}

function test(key: keyof Matcher, matcher: Matcher, message: RoutableMessage): boolean {
  switch (key) {
    case "subjectContains":
      return contains(message.subject, matcher.subjectContains ?? []);
    case "bodyContains":
      return contains(message.bodyText, matcher.bodyContains ?? []);
    case "senderIsKnownCompany":
      return message.senderIsKnownCompany === matcher.senderIsKnownCompany;
    case "senderIsKnownSupplier":
      return message.senderIsKnownSupplier === matcher.senderIsKnownSupplier;
    case "attachmentLooksLike":
      return message.attachmentKinds.includes(matcher.attachmentLooksLike ?? "");
    case "bodyContainsPrice":
      return bodyLooksLikeItHasAPrice(message.bodyText) === matcher.bodyContainsPrice;
    default:
      return false;
  }
}

/**
 * Route one message.
 *
 * The confidence floor is applied HERE rather than at the call site, so there is
 * no path through this module that returns `auto` on a guess. That is what
 * "Enforced" means on screen 38.
 */
export function route(message: RoutableMessage, rules: RoutingRule[]): RoutingDecision {
  const ordered = rules.filter((r) => r.enabled).sort((a, b) => a.position - b.position);

  for (const rule of ordered) {
    const { hit, confidence, matched } = evaluate(rule, message);
    if (!hit) continue;

    const wantsAuto = rule.mode === "auto";
    const downgraded = wantsAuto && confidence < AUTO_CREATE_FLOOR;

    return {
      rule,
      creates: rule.creates,
      mode: downgraded ? "suggest" : rule.mode,
      confidence,
      matched,
      downgraded,
    };
  }

  // No rule matched at all — which the seeded rules make impossible, but a
  // person can disable the catch-all. Unmatched mail goes to Needs review.
  return {
    rule: null,
    creates: "needsReview",
    mode: "manual",
    confidence: 0,
    matched: [],
    downgraded: false,
  };
}
