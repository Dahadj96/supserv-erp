import type { CheckState } from "../offer/submit";

/**
 * Screen 08 — where this tender is in the run.
 *
 * The other half of task 2.6. The enquiry run is `dealChecks`; this is the
 * tender one, and the audit names its four rungs: folder pieces → BPU priced →
 * caution → submitted.
 *
 * Same shape as `submitChecks` and `dealChecks`, and `CheckState` is imported
 * rather than redeclared for the same reason those two import it: four screens
 * now say `pass`, `warn`, `block` and `note`, and four independent definitions
 * of those words is how two of them come to mean different things.
 *
 * LAW 1. Every answer is computed from rows that already exist — the folder's
 * own count, the BPU's priced lines, two dates the bank decides and one the
 * deposit writes. There is no `tender_progress` and there must not be one: a
 * stored step would survive somebody removing the piece it was about, and this
 * screen's whole argument is that a folder complete in July is not complete in
 * September without anybody touching a row.
 */

export const TENDER_STEPS = ["folder", "bpu", "caution", "deposit"] as const;
export type TenderStepKey = (typeof TENDER_STEPS)[number];

export type TenderStep = {
  key: TenderStepKey;
  state: CheckState;
  detail?: Record<string, string | number>;
  fixHref?: string;
};

export type TenderStepFacts = {
  dealId: string;
  /** Pieces this cahier des charges asks for, and how many are ready. */
  pieces: number;
  ready: number;
  /** Pieces that would have the bid rejected: missing, expired, or dead by the deposit. */
  blocking: number;
  /** Lines on the bordereau, and how many carry a price we intend to charge. */
  lines: number;
  priced: number;
  /**
   * Whether this procedure asks for a bid bond at all.
   *
   * Read from the tender's own `caution_amount` / `caution_pct` — what the
   * cahier des charges said — and NOT from the piece list: `seedFor` leaves the
   * caution out of an RFQ and a consultation, so inferring it from the folder
   * would make the step appear and disappear as somebody edits pieces.
   */
  cautionRequired: boolean;
  cautionRequestedAt: Date | null;
  cautionReceivedAt: Date | null;
  submittedAt: Date | null;
};

/**
 * What is waiting on somebody, in the order the run happens.
 *
 * A DEPOSITED TENDER IS NOT A LIST OF THINGS TO DO. Once the envelope is on the
 * desk every step is finished by definition — the folder is what was handed
 * over, the prices are what was bid — so the run reads as done rather than
 * reproaching somebody for a piece they knowingly went without. What was
 * missing at the moment of the deposit is in the audit entry `markSubmitted`
 * writes, which is where that belongs.
 */
export function tenderSteps(facts: TenderStepFacts): TenderStep[] {
  const submitted = facts.submittedAt !== null;
  const out: TenderStep[] = [];

  /*
    THE FOLDER. An empty one is not ready — it is a folder nobody has looked at,
    which is a different thing from a folder with a piece missing, and it warns
    rather than blocking because "this consultation asks for no papers at all"
    is a legitimate answer somebody can give by leaving it empty.
  */
  out.push(
    facts.pieces === 0
      ? { key: "folder", state: submitted ? "pass" : "warn", detail: { ready: 0, total: 0 } }
      : facts.blocking > 0 && !submitted
        ? {
            key: "folder",
            state: "block",
            detail: { ready: facts.ready, total: facts.pieces, blocking: facts.blocking },
          }
        : {
            key: "folder",
            state: "pass",
            detail: { ready: facts.ready, total: facts.pieces, blocking: facts.blocking },
          },
  );

  /*
    THE BORDEREAU. Nothing imported is a note and not a failure: a tender for a
    service carries no bordereau des prix, and screen 42 is where one arrives
    when there is one. Imported and part-priced blocks, because a bid submitted
    with an unpriced line is a bid that will be read as an omission at the
    opening — that is the one thing on this screen the desk actually rejects
    for, after the folder.
  */
  out.push(
    facts.lines === 0
      ? { key: "bpu", state: submitted ? "pass" : "note", detail: { priced: 0, lines: 0 } }
      : facts.priced < facts.lines && !submitted
        ? {
            key: "bpu",
            state: "block",
            detail: { priced: facts.priced, lines: facts.lines },
            fixHref: `/tenders/${facts.dealId}/bpu`,
          }
        : { key: "bpu", state: "pass", detail: { priced: facts.priced, lines: facts.lines } },
  );

  /*
    THE BID BOND. Only when the cahier des charges asked for one — an RFQ and a
    consultation carry none, and a permanently red caution row on every private
    consultation is exactly the "four permanent red rows" `pieces.ts` refused to
    seed. Asked for and not yet back WARNS rather than blocks: the bank takes
    days and there is nothing anybody can do faster, so it is a thing to watch
    and not a thing to fix.
  */
  if (facts.cautionRequired) {
    out.push(
      facts.cautionReceivedAt
        ? { key: "caution", state: "pass", detail: { stage: "received" } }
        : submitted
          ? { key: "caution", state: "pass", detail: { stage: "deposited" } }
          : facts.cautionRequestedAt
            ? {
                key: "caution",
                state: "warn",
                detail: { stage: "requested" },
                fixHref: `/tenders/${facts.dealId}#caution`,
              }
            : {
                key: "caution",
                state: "block",
                detail: { stage: "none" },
                fixHref: `/tenders/${facts.dealId}#caution`,
              },
    );
  }

  /*
    THE DEPOSIT. The last rung, and the only one that is finished by a press
    rather than by something else existing. It blocks while it has not happened
    — that is the point of the whole screen — and the link is the form on this
    same page, which `markSubmitted` will still refuse if the folder is not
    ready. The button is not a promise that it will be accepted.
  */
  out.push(
    submitted
      ? { key: "deposit", state: "pass" }
      : {
          key: "deposit",
          state: "block",
          detail: { blocking: facts.blocking },
          fixHref: `/tenders/${facts.dealId}#deposit`,
        },
  );

  return out;
}

/** The first thing actually waiting on somebody. Screen 06's rule, screen 08's run. */
export function nextTenderStep(steps: TenderStep[]): TenderStep | null {
  return (
    steps.find((s) => s.state === "block") ??
    steps.find((s) => s.state === "warn") ??
    steps.find((s) => s.state === "note") ??
    null
  );
}
