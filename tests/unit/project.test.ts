import { describe, expect, it } from "vitest";
import {
  CAUTION_STATES,
  type CautionInput,
  CREW_STATES,
  type CrewInput,
  cautionState,
  crewState,
  needsAttention,
  readCautions,
} from "@/domain/project/cautions";
import {
  PROJECT_STATES,
  progressOf,
  projectState,
  retentionRelease,
  SITUATION_STATES,
  type SituationInput,
  situationState,
} from "@/domain/project/progress";

/**
 * Screens 15 and 16.
 *
 * Two facts drive almost everything here and neither can be stored as one
 * column: a situation is SUBMITTED and separately APPROVED, and a caution
 * EXPIRES on a date that may fall before the work is accepted.
 */

const NOW = new Date("2026-08-21T09:00:00Z");

function situation(over: Partial<SituationInput> = {}): SituationInput {
  return {
    documentId: "d1",
    sequence: 1,
    number: "SIT-2026-0001",
    amountExcl: "620000",
    submittedOn: "2026-06-04",
    approvedOn: "2026-06-20",
    paid: "0",
    ...over,
  };
}

describe("a situation is submitted and separately approved", () => {
  it("is a draft while it has no number", () => {
    expect(situationState(situation({ number: null, submittedOn: null, approvedOn: null }))).toBe(
      "draft",
    );
  });

  it("is submitted once it has gone out and nobody has signed", () => {
    expect(situationState(situation({ approvedOn: null }))).toBe("submitted");
  });

  it("is approved when the client's engineer signed it", () => {
    expect(situationState(situation())).toBe("approved");
  });

  it("is paid once money has been allocated against it", () => {
    expect(situationState(situation({ paid: "500000" }))).toBe("paid");
  });

  it("counts the days a signature has been waited on, and only then", () => {
    const waiting = progressOf({
      situations: [situation({ approvedOn: null, submittedOn: "2026-07-28" })],
      contract: "5180000",
      retentionPct: "5",
      physicalPercent: null,
      now: NOW,
    });
    expect(waiting.situations[0]?.waitingDays).toBe(24);

    const signed = progressOf({
      situations: [situation()],
      contract: "5180000",
      retentionPct: "5",
      physicalPercent: null,
      now: NOW,
    });
    expect(signed.situations[0]?.waitingDays).toBeNull();
  });

  it("never reports a negative wait for a situation submitted tomorrow", () => {
    const early = progressOf({
      situations: [situation({ approvedOn: null, submittedOn: "2026-09-01" })],
      contract: null,
      retentionPct: "5",
      physicalPercent: null,
      now: NOW,
    });
    expect(early.situations[0]?.waitingDays).toBe(0);
  });

  it("never invents a state the screen has no label for", () => {
    for (const one of [
      situation(),
      situation({ number: null }),
      situation({ approvedOn: null }),
      situation({ paid: "1" }),
      situation({ submittedOn: null, approvedOn: null, number: null }),
    ]) {
      expect(SITUATION_STATES).toContain(situationState(one));
    }
  });
});

describe("what the project is worth today", () => {
  const situations: SituationInput[] = [
    situation({ sequence: 1, amountExcl: "620000", paid: "589000" }),
    situation({ sequence: 2, documentId: "d2", amountExcl: "720000", paid: "684000" }),
    situation({
      sequence: 3,
      documentId: "d3",
      amountExcl: "1840000",
      submittedOn: "2026-07-28",
      approvedOn: null,
      paid: "0",
    }),
  ];

  const progress = progressOf({
    situations,
    contract: "5180000",
    retentionPct: "5",
    physicalPercent: 62,
    now: NOW,
  });

  it("counts only what the client has signed as progress", () => {
    // 620 000 + 720 000. The 1 840 000 is submitted and unsigned.
    expect(progress.money.approved).toBe("1340000.00");
    expect(progress.money.awaitingApproval).toBe("1840000.00");
  });

  it("holds retention on approved situations only", () => {
    // 5 % of 1 340 000. Nothing has been withheld from a situation nobody has
    // agreed to, and counting it would overstate what comes back at the end.
    expect(progress.money.retentionHeld).toBe("67000.00");
  });

  it("floors the financial percentage", () => {
    // 1 340 000 / 5 180 000 = 25.86…
    expect(progress.financialPercent).toBe(25);
  });

  it("keeps physical progress as the person's estimate, untouched", () => {
    expect(progress.physicalPercent).toBe(62);
  });

  it("reports the gap between work done and work billed", () => {
    // The most useful number on the screen: 37 points of work done and not yet
    // asked for. That is money the company has spent.
    expect(progress.aheadOfBilling).toBe(37);
  });

  it("says nothing about the gap when nobody has estimated the work", () => {
    const noEstimate = progressOf({
      situations,
      contract: "5180000",
      retentionPct: "5",
      physicalPercent: null,
      now: NOW,
    });
    expect(noEstimate.aheadOfBilling).toBeNull();
  });

  it("names the situation that has been waiting longest", () => {
    expect(progress.longestWait?.sequence).toBe(3);
    expect(progress.longestWait?.waitingDays).toBe(24);
  });

  it("has no opinion on a percentage with no contract value", () => {
    const noContract = progressOf({
      situations,
      contract: null,
      retentionPct: "5",
      physicalPercent: 62,
      now: NOW,
    });
    expect(noContract.financialPercent).toBeNull();
    expect(noContract.money.remaining).toBe("0.00");
  });

  it("never reports more than a hundred per cent, or a negative remainder", () => {
    const over = progressOf({
      situations: [situation({ amountExcl: "6000000" })],
      contract: "5180000",
      retentionPct: "5",
      physicalPercent: null,
      now: NOW,
    });
    expect(over.financialPercent).toBe(100);
    expect(over.money.remaining).toBe("0.00");
  });

  it("survives a project with no situations at all", () => {
    const empty = progressOf({
      situations: [],
      contract: "5180000",
      retentionPct: "5",
      physicalPercent: null,
      now: NOW,
    });
    expect(empty.financialPercent).toBe(0);
    expect(empty.longestWait).toBeNull();
    expect(empty.money.retentionHeld).toBe("0.00");
  });
});

describe("when the retention comes back", () => {
  it("is due the day the PV définitif is signed, because that is when the warranty ended", () => {
    // Not définitif + 12. The délai de garantie runs from the PROVISOIRE and
    // the définitive is what ends it; adding the warranty again put the money a
    // second year out and told the Gérant to sit on a demand he could send.
    const release = retentionRelease({
      pvProvisoireOn: "2026-10-05",
      pvDefinitiveOn: "2027-11-01",
      warrantyMonths: 12,
    });
    expect(release).toEqual({ on: "2027-11-01", basis: "definitive" });
  });

  it("says the définitive's date even when nobody typed a warranty period", () => {
    // The right opened on a date somebody recorded. It does not depend on a
    // number being in the CCAP field.
    expect(
      retentionRelease({
        pvProvisoireOn: "2026-10-05",
        pvDefinitiveOn: "2027-11-01",
        warrantyMonths: null,
      }),
    ).toEqual({ on: "2027-11-01", basis: "definitive" });
  });

  it("projects off the provisional acceptance until then, and says so", () => {
    // The screen labels this "expected". A projection presented as a promise is
    // how somebody plans a year around a date that has not been set.
    const release = retentionRelease({
      pvProvisoireOn: "2026-10-05",
      pvDefinitiveOn: null,
      warrantyMonths: 12,
    });
    expect(release).toEqual({ on: "2027-10-05", basis: "provisional" });
  });

  it("says nothing when neither acceptance has happened", () => {
    expect(
      retentionRelease({ pvProvisoireOn: null, pvDefinitiveOn: null, warrantyMonths: 12 }),
    ).toEqual({ on: null, basis: "unknown" });
  });

  it("says nothing when nobody recorded a warranty period", () => {
    expect(
      retentionRelease({
        pvProvisoireOn: "2026-10-05",
        pvDefinitiveOn: null,
        warrantyMonths: null,
      }),
    ).toEqual({ on: null, basis: "unknown" });
  });
});

describe("the retention actually coming back", () => {
  const held: SituationInput[] = [
    situation({ sequence: 1, amountExcl: "620000", paid: "589000" }),
    situation({ sequence: 2, documentId: "d2", amountExcl: "720000", paid: "684000" }),
  ];

  function money(released?: string) {
    return progressOf({
      situations: held,
      contract: "5180000",
      retentionPct: "5",
      retentionReleased: released,
      physicalPercent: null,
      now: NOW,
    }).money;
  }

  it("is outstanding in full until a dinar of it arrives", () => {
    const m = money();
    expect(m.retentionHeld).toBe("67000.00");
    expect(m.retentionReleased).toBe("0.00");
    expect(m.retentionOutstanding).toBe("67000.00");
  });

  it("does not let held fall when part of it comes back", () => {
    // Held is what the SITUATIONS withheld and an issued situation cannot
    // change. Only the outstanding figure moves.
    const m = money("20000");
    expect(m.retentionHeld).toBe("67000.00");
    expect(m.retentionOutstanding).toBe("47000.00");
  });

  it("never reports a negative outstanding when the client overpays", () => {
    expect(money("80000").retentionOutstanding).toBe("0.00");
  });

  it("closes the marché on the outstanding figure, not on the held one", () => {
    // The bug this pair exists for: projectState was reading `retentionHeld`,
    // which never falls, so no marché could ever leave WARRANTY however much
    // money arrived.
    const m = money("67000");
    expect(
      projectState({
        closedAt: null,
        pvProvisoireOn: "2026-10-05",
        retentionHeld: m.retentionHeld,
      }),
    ).toBe("warranty");
    expect(
      projectState({
        closedAt: null,
        pvProvisoireOn: "2026-10-05",
        retentionHeld: m.retentionOutstanding,
      }),
    ).toBe("closed");
  });

  it("keeps the marché in warranty while the demand is unanswered", () => {
    // Issuing the levée does not release anything. Money arriving does.
    expect(
      projectState({
        closedAt: null,
        pvProvisoireOn: "2026-10-05",
        retentionHeld: money("0").retentionOutstanding,
      }),
    ).toBe("warranty");
  });
});

describe("active, warranty, closed", () => {
  it("is active until the work is accepted", () => {
    expect(projectState({ closedAt: null, pvProvisoireOn: null, retentionHeld: "67000" })).toBe(
      "active",
    );
  });

  it("is in WARRANTY once accepted while the client still holds the retention", () => {
    // Not closed. A project marked closed at provisional acceptance is a
    // project whose 640 000 DZD nobody goes back for.
    expect(
      projectState({ closedAt: null, pvProvisoireOn: "2026-10-05", retentionHeld: "640000" }),
    ).toBe("warranty");
  });

  it("is closed once accepted with nothing held back", () => {
    expect(projectState({ closedAt: null, pvProvisoireOn: "2026-10-05", retentionHeld: "0" })).toBe(
      "closed",
    );
  });

  it("is closed the moment somebody closes it, whatever else is true", () => {
    expect(
      projectState({ closedAt: new Date(), pvProvisoireOn: null, retentionHeld: "640000" }),
    ).toBe("closed");
  });

  it("never invents a state the screen has no label for", () => {
    for (const one of [
      { closedAt: null, pvProvisoireOn: null, retentionHeld: "0" },
      { closedAt: null, pvProvisoireOn: "2026-01-01", retentionHeld: "1" },
      { closedAt: new Date(), pvProvisoireOn: "2026-01-01", retentionHeld: "1" },
    ]) {
      expect(PROJECT_STATES).toContain(projectState(one));
    }
  });
});

describe("the bank guarantees", () => {
  function caution(over: Partial<CautionInput> = {}): CautionInput {
    return {
      id: "c1",
      kind: "bonne_execution",
      amount: "259000",
      pct: "5",
      bankName: "BEA",
      reference: "CBE/2026/0044",
      expiresOn: "2026-12-31",
      releasedOn: null,
      ...over,
    };
  }

  it("is live when it outlives the acceptance comfortably", () => {
    const state = cautionState({ caution: caution(), now: NOW, acceptanceOn: "2026-10-05" });
    expect(state.state).toBe("live");
  });

  it("EXPIRES BEFORE ACCEPTANCE — the client can call it in", () => {
    // The banner on screen 16, and the same shape as the tender dossier's
    // "expires before deposit": valid today, useless on the day it is needed.
    const state = cautionState({
      caution: caution({ expiresOn: "2026-08-29" }),
      now: NOW,
      acceptanceOn: "2026-10-05",
    });
    expect(state.state).toBe("expiresBeforeAcceptance");
    expect(needsAttention(state.state)).toBe(true);
  });

  it("does not soften that into 'expiring soon' just because it is close", () => {
    const state = cautionState({
      caution: caution({ expiresOn: "2026-08-29" }),
      now: NOW,
      acceptanceOn: "2026-10-05",
    });
    expect(state.state).not.toBe("expiring");
  });

  it("is merely expiring when it outlives the acceptance but not by much", () => {
    // Expiring ON the acceptance day, not before it: still valid that morning,
    // and 45 days out, which is about what a bank takes to renew one.
    const state = cautionState({
      caution: caution({ expiresOn: "2026-10-05" }),
      now: NOW,
      acceptanceOn: "2026-10-05",
    });
    expect(state.state).toBe("expiring");
    expect(state.daysLeft).toBe(45);
  });

  it("clears the expiring window by a day and goes quiet", () => {
    const state = cautionState({
      caution: caution({ expiresOn: "2026-10-06" }),
      now: NOW,
      acceptanceOn: "2026-10-05",
    });
    expect(state.state).toBe("live");
  });

  it("is lapsed once the date has passed", () => {
    const state = cautionState({
      caution: caution({ expiresOn: "2026-08-01" }),
      now: NOW,
      acceptanceOn: "2026-10-05",
    });
    expect(state.state).toBe("lapsed");
  });

  it("is released and needs nothing once the client gives it back", () => {
    const state = cautionState({
      caution: caution({ releasedOn: "2026-08-10", expiresOn: "2026-08-01" }),
      now: NOW,
      acceptanceOn: "2026-10-05",
    });
    expect(state.state).toBe("released");
    expect(needsAttention(state.state)).toBe(false);
  });

  it("falls back to the expiring window with no acceptance date", () => {
    const state = cautionState({
      caution: caution({ expiresOn: "2026-09-15" }),
      now: NOW,
      acceptanceOn: null,
    });
    expect(state.state).toBe("expiring");
  });

  it("never invents a state the screen has no label for", () => {
    const all = readCautions({
      cautions: [
        caution(),
        caution({ expiresOn: null }),
        caution({ expiresOn: "2020-01-01" }),
        caution({ releasedOn: "2026-01-01" }),
      ],
      now: NOW,
      acceptanceOn: "2026-10-05",
    });
    for (const one of all) expect(CAUTION_STATES).toContain(one.state);
  });
});

describe("who is on site, and whether their ticket is valid", () => {
  function member(over: Partial<CrewInput> = {}): CrewInput {
    return {
      id: "m1",
      personId: "p1",
      name: "H. Ferhat",
      trade: "Soudeur",
      role: null,
      onSiteSince: "2026-05-12",
      leftOn: null,
      proposedAt: null,
      certification: "Soudage arc",
      certificationExpiresOn: "2026-08-30",
      ...over,
    };
  }

  it("is proposed while nobody has put them on site", () => {
    expect(crewState({ member: member({ onSiteSince: null }), now: NOW }).state).toBe("proposed");
  });

  it("is on site with a ticket that has months left", () => {
    expect(
      crewState({ member: member({ certificationExpiresOn: "2027-03-12" }), now: NOW }).state,
    ).toBe("onSite");
  });

  it("is on site when they hold no certification at all", () => {
    // A manœuvre needs no ticket. Missing is not expiring.
    expect(
      crewState({
        member: member({ certification: null, certificationExpiresOn: null }),
        now: NOW,
      }).state,
    ).toBe("onSite");
  });

  it("is expiring inside the window it takes to renew one", () => {
    expect(crewState({ member: member(), now: NOW }).state).toBe("expiring");
  });

  it("is EXPIRED, not gone, when the ticket has run out under a man still working", () => {
    // An unqualified welder on a SADEG job is a stopped site, not an
    // administrative note.
    const state = crewState({ member: member({ certificationExpiresOn: "2026-08-01" }), now: NOW });
    expect(state.state).toBe("expired");
    expect(state.daysLeft).toBeLessThan(0);
  });

  it("is left once they have gone, whatever their ticket says", () => {
    expect(
      crewState({
        member: member({ leftOn: "2026-08-10", certificationExpiresOn: "2020-01-01" }),
        now: NOW,
      }).state,
    ).toBe("left");
  });

  it("never invents a state the screen has no label for", () => {
    for (const one of [
      member(),
      member({ onSiteSince: null }),
      member({ leftOn: "2026-01-01" }),
      member({ certificationExpiresOn: null }),
      member({ certificationExpiresOn: "2020-01-01" }),
    ]) {
      expect(CREW_STATES).toContain(crewState({ member: one, now: NOW }).state);
    }
  });
});
