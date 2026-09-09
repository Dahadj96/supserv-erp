import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEAL_CHECKS } from "@/domain/deal/checks";
import {
  nextTenderStep,
  TENDER_STEPS,
  type TenderStepFacts,
  tenderSteps,
} from "@/domain/tender/steps";

/**
 * Screen 08's run (task 2.6), and the copy both runs need.
 *
 * The stepper NUMBERS its rows, which changes what a bug in this file costs.
 * Before 2.6 a check in the wrong order read oddly; now it prints a 3 above a
 * 2, and a step that appears on one load and not the next renumbers everything
 * under it. So the properties worth pinning are order, and that a step only
 * ever appears when the run it belongs to has actually reached it.
 */
const root = join(import.meta.dirname, "..", "..");
const load = (locale: string) =>
  JSON.parse(readFileSync(join(root, "src/i18n/messages", `${locale}.json`), "utf8"));
const en = load("en");
const fr = load("fr");

const facts = (over: Partial<TenderStepFacts> = {}): TenderStepFacts => ({
  dealId: "t-1",
  pieces: 19,
  ready: 19,
  blocking: 0,
  lines: 0,
  priced: 0,
  cautionRequired: false,
  cautionRequestedAt: null,
  cautionReceivedAt: null,
  submittedAt: null,
  ...over,
});

describe("screen 08 — where this tender is", () => {
  it("blocks on a folder that would have the bid rejected", () => {
    const steps = tenderSteps(facts({ ready: 15, blocking: 4 }));
    const folder = steps.find((s) => s.key === "folder");

    expect(folder?.state).toBe("block");
    expect(folder?.detail?.blocking).toBe(4);
    expect(nextTenderStep(steps)?.key).toBe("folder");
  });

  it("warns rather than blocks on a folder nobody has recorded a piece for", () => {
    // Empty is not the same claim as incomplete. "This consultation asks for no
    // papers" is an answer somebody gives by leaving the folder alone.
    expect(tenderSteps(facts({ pieces: 0, ready: 0 })).find((s) => s.key === "folder")?.state).toBe(
      "warn",
    );
  });

  it("calls a missing bordereau a note and a half-priced one a blocker", () => {
    // Not every tender has a BPU — a service does not. One that HAS been
    // imported and is part-priced is the case the desk reads as an omission.
    expect(tenderSteps(facts()).find((s) => s.key === "bpu")?.state).toBe("note");

    const half = tenderSteps(facts({ lines: 40, priced: 31 })).find((s) => s.key === "bpu");
    expect(half?.state).toBe("block");
    expect(half?.detail).toEqual({ priced: 31, lines: 40 });
    expect(half?.fixHref).toBe("/tenders/t-1/bpu");

    expect(tenderSteps(facts({ lines: 40, priced: 40 })).find((s) => s.key === "bpu")?.state).toBe(
      "pass",
    );
  });

  it("shows the bond only when the cahier des charges asked for one", () => {
    /*
      Read from the tender's own amount or percentage, never from whether the
      folder happens to carry a `caution` piece — `seedFor` leaves that piece
      out of an RFQ and a consultation, so reading it off the folder would make
      a numbered step appear and disappear as somebody edits pieces, renumbering
      the deposit under it.
    */
    expect(tenderSteps(facts()).map((s) => s.key)).not.toContain("caution");
    expect(tenderSteps(facts({ cautionRequired: true })).map((s) => s.key)).toContain("caution");
  });

  it("warns while the bank has it, and blocks while nobody has asked", () => {
    // Asked for and not back is a thing to watch: the bank takes days and
    // nobody can go faster. Not asked for at all is a thing to do today.
    const asked = tenderSteps(
      facts({ cautionRequired: true, cautionRequestedAt: new Date("2026-09-01T09:00:00Z") }),
    ).find((s) => s.key === "caution");
    const neither = tenderSteps(facts({ cautionRequired: true })).find((s) => s.key === "caution");
    const back = tenderSteps(
      facts({ cautionRequired: true, cautionReceivedAt: new Date("2026-09-05T09:00:00Z") }),
    ).find((s) => s.key === "caution");

    expect(neither?.state).toBe("block");
    expect(asked?.state).toBe("warn");
    expect(back?.state).toBe("pass");
  });

  it("reads a deposited tender as finished rather than as a list of failures", () => {
    /*
      Screen 06 does the same for a closed deal. Once the envelope is on the
      desk the folder IS what was handed over, so reproaching somebody for a
      piece they knowingly went without is both useless and wrong — what was
      missing at that moment is in the audit entry `markSubmitted` writes.
    */
    const steps = tenderSteps(
      facts({
        ready: 15,
        blocking: 4,
        lines: 40,
        priced: 31,
        cautionRequired: true,
        submittedAt: new Date("2026-09-02T11:00:00Z"),
      }),
    );

    expect(steps.every((s) => s.state === "pass")).toBe(true);
    expect(nextTenderStep(steps)).toBeNull();
  });

  it("puts the deposit last and blocks on it until it happens", () => {
    const steps = tenderSteps(facts({ lines: 4, priced: 4 }));

    expect(steps.at(-1)?.key).toBe("deposit");
    expect(steps.at(-1)?.state).toBe("block");
    expect(steps.at(-1)?.fixHref).toBe("/tenders/t-1#deposit");
  });

  it("keeps every step in the run's own order, whichever ones apply", () => {
    for (const over of [{}, { cautionRequired: true }, { lines: 9, priced: 2 }]) {
      const steps = tenderSteps(facts(over));
      const order = TENDER_STEPS.filter((key) => steps.some((s) => s.key === key));
      expect(steps.map((s) => s.key)).toEqual(order);
    }
  });
});

describe("the copy both numbered runs need", () => {
  // Every one of these is built from a template literal on screen 06 or 08, so
  // `messages.test.ts` cannot see any of them. A step added to either list and
  // not to both message files is a 500 on the screen it belongs to.
  it("names every rung of the enquiry run in both languages", () => {
    for (const key of DEAL_CHECKS) {
      expect(en.deals.step[key], `en deals.step.${key}`).toBeTypeOf("string");
      expect(fr.deals.step[key], `fr deals.step.${key}`).toBeTypeOf("string");
      expect(en.deals.check[key], `en deals.check.${key}`).toBeTypeOf("string");
      expect(fr.deals.check[key], `fr deals.check.${key}`).toBeTypeOf("string");
    }
  });

  it("names every rung of the tender run in both languages", () => {
    for (const key of TENDER_STEPS) {
      expect(en.tender.step[key], `en tender.step.${key}`).toBeTypeOf("string");
      expect(fr.tender.step[key], `fr tender.step.${key}`).toBeTypeOf("string");
      expect(en.tender.step.detail[key], `en tender.step.detail.${key}`).toBeTypeOf("string");
      expect(fr.tender.step.detail[key], `fr tender.step.detail.${key}`).toBeTypeOf("string");
    }
  });

  it("has the words the shared stepper prints on every screen that uses it", () => {
    for (const messages of [en, fr]) {
      expect(messages.common.done).toBeTypeOf("string");
      expect(messages.common.doneOf).toContain("{done}");
      expect(messages.common.doneOf).toContain("{total}");
      expect(messages.tender.run.title).toBeTypeOf("string");
      expect(messages.tender.run.nothing).toBeTypeOf("string");
      // The badge on a step with nowhere to go, and the verb on one with
      // somewhere. Both predate 2.6 and both are now read by three screens.
      for (const state of ["pass", "warn", "block", "note"]) {
        expect(messages.offer.state[state], `offer.state.${state}`).toBeTypeOf("string");
      }
      expect(messages.deals.next.go).toBeTypeOf("string");
    }
  });
});
