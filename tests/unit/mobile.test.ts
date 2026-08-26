import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPhoneRoute, PHONE_JOBS, PHONE_WIDTH, phoneBar } from "@/mobile";

/**
 * Screen 86 as a test.
 *
 * The rule — capture and approve on the phone, build and decide on the laptop —
 * only survives if adding a fifth phone screen is a thing somebody has to do on
 * purpose. These assertions are the friction.
 */

const APP = "src/app/[locale]/(app)";

/** `/capture` → the folder that would hold its page, if it exists. */
function pageFor(href: string): string {
  return `${APP}${href}/page.tsx`;
}

describe("what a phone is for", () => {
  it("is four things, and they are the four the frame draws", () => {
    expect(PHONE_JOBS.map((j) => j.key)).toEqual(["capture", "price", "approve", "today"]);
    expect(PHONE_JOBS.map((j) => j.screen)).toEqual([61, 74, 65, 55]);
    expect(PHONE_WIDTH).toBe(390);
  });

  it("only calls a job built when its route actually exists", () => {
    for (const job of PHONE_JOBS) {
      expect(
        existsSync(pageFor(job.href)),
        `${job.key} claims built=${job.built} — route ${job.href} ${
          existsSync(pageFor(job.href)) ? "exists" : "does not exist"
        }`,
      ).toBe(job.built);
    }
  });

  it("names the phase for everything not built, and none for what is", () => {
    for (const job of PHONE_JOBS) {
      if (job.built) expect(job.phase).toBeNull();
      else expect(job.phase).toBeGreaterThan(2);
    }
  });

  it("puts only built jobs in the bar's links", () => {
    // The unbuilt ones still appear on the bar, greyed with their phase — but
    // `phoneBar()` is what may be linked, and a link to nothing is a dead end.
    //
    // Written out rather than derived from PHONE_JOBS, which would make it
    // tautological. The point is that shipping a phone job is a deliberate act:
    // somebody flips `built` and comes here to say so.
    expect(phoneBar().map((j) => j.key)).toEqual(["capture", "today"]);
  });
});

describe("recognising a phone route", () => {
  it("ignores the locale prefix, because every route has one", () => {
    expect(isPhoneRoute("/fr/capture")).toBe(true);
    expect(isPhoneRoute("/en/capture")).toBe(true);
    expect(isPhoneRoute("/capture")).toBe(true);
  });

  it("matches a job's children", () => {
    expect(isPhoneRoute("/fr/approvals/abc-123")).toBe(true);
  });

  it("does not match a route that merely starts with the same letters", () => {
    // `/captures` is not `/capture`, and a prefix test that says otherwise is
    // how an unrelated screen quietly acquires a phone layout.
    expect(isPhoneRoute("/fr/captures-report")).toBe(false);
    expect(isPhoneRoute("/fr/offers/1/build")).toBe(false);
    expect(isPhoneRoute("/fr")).toBe(false);
  });
});
