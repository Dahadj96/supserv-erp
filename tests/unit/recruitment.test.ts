import { describe, expect, it } from "vitest";
import {
  CANDIDATE_STAGES,
  isFilled,
  REQUEST_STATES,
  readRequest,
  readShortlist,
  type ShortlistEntry,
  URGENT_WITHIN_DAYS,
} from "@/domain/recruitment/request";

/**
 * Screen 26.
 *
 * The rule that matters is the same one the tender dossier and the project
 * caution follow, for the third time in this system: the date that decides is
 * not today. A welding attestation valid this morning and expired on the day
 * the man is due on site is a man who cannot go, and a screen showing him green
 * would send him.
 */

const NOW = new Date("2026-08-18T09:00:00Z");
const START = "2026-08-24";

function entry(over: Partial<ShortlistEntry> = {}): ShortlistEntry {
  return {
    id: "c1",
    personId: "p1",
    name: "H. Ferhat",
    trade: "Soudeur",
    mobility: "Adrar only",
    stage: "confirmed",
    certification: "Soudage arc",
    certificationExpiresOn: "2026-08-30",
    ...over,
  };
}

function request(over: Partial<Parameters<typeof readRequest>[0]> = {}) {
  const shortlist = readShortlist({
    entries: over.shortlist ? [] : [entry()],
    startOn: START,
    now: NOW,
  });
  return readRequest({
    needed: 2,
    startOn: START,
    status: "open",
    certificationRequired: true,
    shortlist,
    now: NOW,
    ...over,
  });
}

describe("a ticket that lapses before the man is due on site", () => {
  it("is fine when it outlives the start date", () => {
    const rows = readShortlist({ entries: [entry()], startOn: START, now: NOW });
    expect(rows[0]?.certificationLapsesBeforeStart).toBe(false);
    expect(rows[0]?.daysLeftOnCertification).toBe(12);
  });

  it("is flagged when it expires between today and the start", () => {
    const rows = readShortlist({
      entries: [entry({ certificationExpiresOn: "2026-08-22" })],
      startOn: START,
      now: NOW,
    });
    expect(rows[0]?.certificationLapsesBeforeStart).toBe(true);
    // Still four days of validity left, and still useless for this job.
    expect(rows[0]?.daysLeftOnCertification).toBe(4);
  });

  it("says nothing about somebody who holds no certification", () => {
    const rows = readShortlist({
      entries: [entry({ certification: null, certificationExpiresOn: null })],
      startOn: START,
      now: NOW,
    });
    expect(rows[0]?.certificationLapsesBeforeStart).toBe(false);
    expect(rows[0]?.daysLeftOnCertification).toBeNull();
  });

  it("says nothing when the request has no start date to judge against", () => {
    const rows = readShortlist({
      entries: [entry({ certificationExpiresOn: "2020-01-01" })],
      startOn: null,
      now: NOW,
    });
    expect(rows[0]?.certificationLapsesBeforeStart).toBe(false);
  });
});

describe("how many people this request actually has", () => {
  it("counts a confirmed man with a valid ticket", () => {
    const one = request();
    expect(one.confirmed).toBe(1);
    expect(one.usable).toBe(1);
  });

  it("does NOT count a confirmed man whose ticket lapses, when the site needs one", () => {
    // He is not a warning. He is one man short.
    const shortlist = readShortlist({
      entries: [entry({ certificationExpiresOn: "2026-08-22" })],
      startOn: START,
      now: NOW,
    });
    const one = readRequest({
      needed: 2,
      startOn: START,
      status: "open",
      certificationRequired: true,
      shortlist,
      now: NOW,
    });
    expect(one.confirmed).toBe(1);
    expect(one.usable).toBe(0);
    expect(one.blocked).toHaveLength(1);
  });

  it("counts him anyway on a site that requires no certification", () => {
    // A manœuvre needs no ticket. Judging him against one would make every
    // labourer permanently unusable.
    const shortlist = readShortlist({
      entries: [entry({ certificationExpiresOn: "2026-08-22" })],
      startOn: START,
      now: NOW,
    });
    const one = readRequest({
      needed: 1,
      startOn: START,
      status: "open",
      certificationRequired: false,
      shortlist,
      now: NOW,
    });
    expect(one.usable).toBe(1);
    expect(one.state).toBe("filled");
    expect(one.blocked).toEqual([]);
  });

  it("ignores everybody who is not confirmed", () => {
    const shortlist = readShortlist({
      entries: [
        entry({ id: "a", personId: "a", stage: "shortlisted" }),
        entry({ id: "b", personId: "b", stage: "interview" }),
        entry({ id: "c", personId: "c", stage: "rejected" }),
      ],
      startOn: START,
      now: NOW,
    });
    const one = readRequest({
      needed: 1,
      startOn: START,
      status: "open",
      certificationRequired: true,
      shortlist,
      now: NOW,
    });
    expect(one.confirmed).toBe(0);
  });
});

describe("open, urgent, late, filled", () => {
  it("is urgent inside the window before the start date", () => {
    expect(request().state).toBe("urgent");
    expect(request().daysToStart).toBe(6);
    expect(URGENT_WITHIN_DAYS).toBeGreaterThan(0);
  });

  it("is merely open when the start is comfortably away", () => {
    const shortlist = readShortlist({ entries: [entry()], startOn: "2026-11-01", now: NOW });
    expect(
      readRequest({
        needed: 2,
        startOn: "2026-11-01",
        status: "open",
        certificationRequired: true,
        shortlist,
        now: NOW,
      }).state,
    ).toBe("open");
  });

  it("is LATE once the start date has passed with nobody on site", () => {
    const shortlist = readShortlist({ entries: [], startOn: "2026-08-01", now: NOW });
    expect(
      readRequest({
        needed: 2,
        startOn: "2026-08-01",
        status: "open",
        certificationRequired: true,
        shortlist,
        now: NOW,
      }).state,
    ).toBe("late");
  });

  it("is filled the moment enough usable people are confirmed", () => {
    const shortlist = readShortlist({
      entries: [entry({ id: "a", personId: "a" }), entry({ id: "b", personId: "b" })],
      startOn: START,
      now: NOW,
    });
    const one = readRequest({
      needed: 2,
      startOn: START,
      status: "open",
      certificationRequired: true,
      shortlist,
      now: NOW,
    });
    expect(one.state).toBe("filled");
    expect(isFilled(one)).toBe(true);
  });

  it("stays filled even when the start date has gone by", () => {
    // Late is about being short of people, not about the calendar.
    const shortlist = readShortlist({
      entries: [entry({ certificationExpiresOn: "2027-01-01" })],
      startOn: "2026-08-01",
      now: NOW,
    });
    expect(
      readRequest({
        needed: 1,
        startOn: "2026-08-01",
        status: "open",
        certificationRequired: true,
        shortlist,
        now: NOW,
      }).state,
    ).toBe("filled");
  });

  it("is cancelled whatever else is true, because that is a decision", () => {
    expect(request({ status: "cancelled" }).state).toBe("cancelled");
  });

  it("has an opinion about a request with no start date", () => {
    const shortlist = readShortlist({ entries: [], startOn: null, now: NOW });
    const one = readRequest({
      needed: 1,
      startOn: null,
      status: "open",
      certificationRequired: false,
      shortlist,
      now: NOW,
    });
    expect(one.state).toBe("open");
    expect(one.daysToStart).toBeNull();
  });

  it("never invents a state the screen has no label for", () => {
    for (const status of ["open", "cancelled", "filled", "something_else"]) {
      const one = request({ status });
      expect(REQUEST_STATES).toContain(one.state);
    }
  });

  it("keeps every shortlist stage inside the declared set", () => {
    for (const stage of CANDIDATE_STAGES) {
      const rows = readShortlist({ entries: [entry({ stage })], startOn: START, now: NOW });
      expect(CANDIDATE_STAGES).toContain(rows[0]?.stage);
    }
  });
});
