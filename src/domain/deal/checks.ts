import type { CheckState } from "../offer/submit";
import type { DealFacts } from "./stage";

/**
 * Screen 06 — "what happens next".
 *
 * WHY. Eight cards render on the deal page at once, in the order somebody
 * happened to write them, and every one of them is equally loud. A person
 * opening an enquiry has to read all eight to work out which one is waiting on
 * them, and the answer is usually one line: nobody has said whether we are
 * bidding, or nobody has typed in what the client asked for.
 *
 * The shape is `submitChecks`'s, deliberately and not by coincidence. Screen 12
 * already answers "what stops this offer going out" with
 * `{ key, state, detail, fixHref }`, screen 18 answers the same question about
 * issuing, and this answers it about the deal. Three screens, one idea, one set
 * of markup — and `CheckState` is imported rather than redeclared so they
 * cannot drift into meaning different things by the same names.
 *
 * LAW 1 runs through the whole file. Nothing here is stored and nothing may be:
 * every answer is computed from `DealFacts`, which `getDeal` already builds on
 * every load, plus a handful of columns the page has in its hands. A `progress`
 * column would be a second opinion that goes wrong the first time somebody
 * issues an offer from a screen that forgot to update it.
 */

export const DEAL_CHECKS = [
  "closed",
  "decision",
  "lines",
  "deadline",
  "suppliers",
  "offer",
  "clientAnswer",
  "invoice",
] as const;
export type DealCheckKey = (typeof DEAL_CHECKS)[number];

export type DealCheck = {
  key: DealCheckKey;
  state: CheckState;
  /** Extra values for the sentence the screen prints. */
  detail?: Record<string, string | number>;
  /** The route that does it, when one screen obviously does. */
  fixHref?: string;
};

/**
 * Everything the panel is allowed to know.
 *
 * `DealFacts` and nothing but columns already on the row. No new query: the
 * point of building this on the facts `getDeal` computes anyway is that the
 * panel costs a function call rather than a page load.
 */
export type DealCheckFacts = DealFacts & {
  dealId: string;
  /** False once the deal is won, lost or no-bid. Screen 05's `open`. */
  open: boolean;
  deadlineAt: Date | null;
  /** Offers that EXIST, drafts included. `offersIssued` counts only issued ones. */
  offersDrafted: number;
  /** The draft offer to send somebody to, when there is exactly one to point at. */
  draftOfferId: string | null;
};

/**
 * What is waiting on somebody, most pressing first.
 *
 * ORDER IS THE WHOLE POINT and it is the run itself: decide, know what was
 * asked for, know when it is due, get prices, put an offer out, hear back,
 * invoice. A panel that listed the same eight things in a different order every
 * load would be the eight cards again with a border round them.
 *
 * `block` is "this stops the next step", `warn` is "worth reading", `note` is a
 * fact rather than a problem — the same three meanings screen 12 gives them,
 * and the reason the type is imported rather than copied.
 */
export function dealChecks(facts: DealCheckFacts): DealCheck[] {
  /*
    A CLOSED DEAL IS NOT A LIST OF FAILURES.

    Won, lost or walked away from: every check below would report something
    missing, and all of it would be true and none of it would be anything to
    do. A deal that ended is one line saying so — and it is deliberately not
    silence, because "why is this panel empty" is a question somebody asks.
  */
  if (!facts.open) {
    const how = facts.lostAt ? "lost" : facts.decision === "no_bid" ? "noBid" : "won";
    return [{ key: "closed", state: "note", detail: { how } }];
  }

  const out: DealCheck[] = [];

  /*
    THE FIRST QUESTION, AND THE ONE MOST OFTEN UNANSWERED.

    "Recorded so we can learn from it" is the caption on screen 06's go/no-go
    card, and it only works if somebody answers it. A null decision is not a
    missing field, it is an enquiry nobody has looked at.
  */
  /*
    EVERY CHECK CARRIES ITS OWN `detail`, INCLUDING THE FAILING ONE.

    The sentences on screen are ICU `select` and `plural`, which throw rather
    than degrade when the argument they name is not passed. A check that
    supplied a detail only when it passed would crash the deal page on exactly
    the deals the panel exists for.
  */
  out.push(
    facts.decision === null
      ? {
          key: "decision",
          state: "block",
          detail: { decision: "none" },
          fixHref: `/deals/${facts.dealId}#decision`,
        }
      : { key: "decision", state: "pass", detail: { decision: facts.decision } },
  );

  // Nothing downstream exists without these: no prices, no offer, no invoice.
  out.push(
    facts.lineCount === 0
      ? { key: "lines", state: "block", detail: { n: 0 }, fixHref: `/deals/${facts.dealId}/items` }
      : { key: "lines", state: "pass", detail: { n: facts.lineCount } },
  );

  /*
    A WARNING, NOT A BLOCKER, AND NO FIX LINK.

    A deal with no deadline is workable — plenty of enquiries have none — so it
    never blocks. It carries no `fixHref` for an honest reason: there is no
    `/deals/[id]/edit` in this application, and the two ways a deadline gets
    onto a deal are `/deals/new` and carrying a confirmed one off a dossier
    (task 2.4). Pointing at a screen that cannot set it would be worse than
    naming the gap.
  */
  if (facts.deadlineAt === null) out.push({ key: "deadline", state: "warn" });

  /*
    ASKING SUPPLIERS IS NOT COMPULSORY, and this says so by warning rather than
    blocking: a price on file from last month is a legitimate way to build an
    offer, and an ERP that refuses to let you quote without a fresh sourcing
    round is one people work around in Word. It stops asking once an offer
    exists — by then the question has been answered one way or the other.
  */
  if (facts.lineCount > 0 && facts.suppliersAsked === 0 && facts.offersDrafted === 0) {
    out.push({ key: "suppliers", state: "warn", fixHref: `/deals/${facts.dealId}#ask` });
  }

  /*
    THE OFFER. A draft is not an offer out — LAW 5 draws that line and
    `offersIssued` counts accordingly — so a deal with a draft sitting on it
    still has something waiting, and the link goes to that draft rather than to
    a form that would make a second one.
  */
  if (facts.lineCount > 0 && facts.offersIssued === 0) {
    out.push({
      key: "offer",
      state: "block",
      detail: { drafts: facts.offersDrafted },
      fixHref: facts.draftOfferId
        ? `/offers/${facts.draftOfferId}/build`
        : `/deals/${facts.dealId}#offer`,
    });
  }

  /*
    WAITING ON SOMEBODY ELSE IS A FACT, NOT A FAILURE.

    The offer has gone out and the client has not answered. Nothing is wrong and
    there is nothing to fix — the same reasoning screen 12 uses for "proof of
    submission — pending", which would otherwise refuse to let somebody submit
    an offer until they had proof of having submitted it.
  */
  if (facts.offersIssued > 0 && facts.ordersReceived === 0) {
    out.push({ key: "clientAnswer", state: "note" });
  }

  /*
    ORDERED AND NOT INVOICED. A warning rather than a block, and with no fix
    link: a facture is raised FROM a document — the bon de commande or the bon
    de livraison — through screen 18's convert, not from the deal, and the deal
    does not know which document that would be. Naming it and letting a person
    pick is better than a link that lands on the wrong one.
  */
  if (facts.ordersReceived > 0 && facts.invoicesIssued === 0) {
    out.push({ key: "invoice", state: "warn" });
  }

  return out;
}

/**
 * The one line the header prints: the first thing actually waiting on somebody.
 *
 * A blocker before a warning before a note, and within each the run order the
 * list is already in. Null when everything that can pass has passed, which is
 * a real state and reads better as nothing than as "all clear" — the panel
 * below still shows every check.
 */
export function nextStep(checks: DealCheck[]): DealCheck | null {
  return (
    checks.find((c) => c.state === "block") ??
    checks.find((c) => c.state === "warn") ??
    checks.find((c) => c.state === "note") ??
    null
  );
}
