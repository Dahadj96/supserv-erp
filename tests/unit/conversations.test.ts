import { describe, expect, it } from "vitest";
import {
  counterpartyKey,
  normaliseSubject,
  stateOf,
  threadKey,
  titleOf,
} from "@/domain/conversation/thread";

/**
 * Screen 57 groups messages into conversations without storing a conversation.
 * Everything below is the grouping rule, which is the only hard part.
 */
describe("reply prefixes do not start new conversations", () => {
  it("strips the ones a French office actually produces", () => {
    const same = [
      "Consultation 25/DA/2026",
      "Re: Consultation 25/DA/2026",
      "RE: Consultation 25/DA/2026",
      "TR: Consultation 25/DA/2026",
      "Rép: Consultation 25/DA/2026",
      "Fwd: Consultation 25/DA/2026",
    ].map(normaliseSubject);

    expect(new Set(same).size, `got ${JSON.stringify([...new Set(same)])}`).toBe(1);
  });

  it("strips a pile of them, in any order", () => {
    // What a subject looks like after two trips round a purchasing department.
    expect(normaliseSubject("RE: TR: Re: Fwd: Demande de prix")).toBe("demande de prix");
  });

  it("handles the numbered form Outlook produces", () => {
    expect(normaliseSubject("RE[2]: Demande de prix")).toBe("demande de prix");
  });

  it("does not eat a subject that merely starts with those letters", () => {
    // "Reprise" begins with "Re" and is not a reply. Requiring the colon is
    // what keeps this from quietly renaming half the inbox.
    expect(normaliseSubject("Reprise des travaux")).toBe("reprise des travaux");
    expect(normaliseSubject("Revision du planning")).toBe("revision du planning");
  });

  it("collapses whitespace and case so near-identical subjects meet", () => {
    expect(normaliseSubject("  Demande   de  PRIX ")).toBe("demande de prix");
  });

  it("survives an empty or missing subject", () => {
    expect(normaliseSubject(null)).toBe("");
    expect(normaliseSubject("Re:")).toBe("");
  });
});

describe("who the conversation is with", () => {
  it("groups three people at one client into one counterparty", () => {
    const a = counterpartyKey("urbacon-id", "a.himer@urbacon.dz");
    const b = counterpartyKey("urbacon-id", "m.kohil@urbacon.dz");
    expect(a).toBe(b);
  });

  it("falls back to the address when nobody has matched the sender", () => {
    // Not the display name: senders spell their own name differently week to
    // week, and the address is the thing that does not move.
    expect(counterpartyKey(null, "Sales@Example.COM")).toBe(
      counterpartyKey(null, "sales@example.com"),
    );
  });

  it("keeps two different unmatched senders apart", () => {
    expect(counterpartyKey(null, "a@x.com")).not.toBe(counterpartyKey(null, "b@x.com"));
  });
});

describe("threadKey", () => {
  it("puts a reply in the same thread as the message it answers", () => {
    expect(threadKey("p1", "a@x.com", "Consultation 25/DA/2026")).toBe(
      threadKey("p1", "b@x.com", "RE: Consultation 25/DA/2026"),
    );
  });

  it("keeps two subjects from the same client apart", () => {
    expect(threadKey("p1", "a@x.com", "Consultation A")).not.toBe(
      threadKey("p1", "a@x.com", "Consultation B"),
    );
  });

  it("keeps the same subject from two clients apart", () => {
    expect(threadKey("p1", "a@x.com", "Demande de prix")).not.toBe(
      threadKey("p2", "b@y.com", "Demande de prix"),
    );
  });
});

describe("the title people read", () => {
  it("is the earliest subject, with its prefixes gone and its case kept", () => {
    // Earliest first: that is the one somebody chose, before the forwarding.
    expect(titleOf(["Consultation 25/DA/2026", "RE: Consultation 25/DA/2026"])).toBe(
      "Consultation 25/DA/2026",
    );
  });

  it("skips empty subjects rather than showing an empty title", () => {
    expect(titleOf([null, "", "Demande de prix"])).toBe("Demande de prix");
  });

  it("is empty when every message was sent without a subject", () => {
    expect(titleOf([null, ""])).toBe("");
  });
});

describe("thread state", () => {
  const open = { status: "needs_review", committedAt: null };
  const dismissed = { status: "dismissed", committedAt: null };
  const committed = { status: "committed", committedAt: new Date() };

  it("needs a reply while anything in it is outstanding", () => {
    expect(stateOf([open])).toBe("needsReply");
    expect(stateOf([committed, open])).toBe("needsReply");
  });

  it("is closed once every message has been dealt with", () => {
    // Dealt with means became a record OR was dismissed with a reason. Both
    // are decisions somebody made; neither is a delete.
    expect(stateOf([committed])).toBe("closed");
    expect(stateOf([dismissed])).toBe("closed");
    expect(stateOf([committed, dismissed])).toBe("closed");
  });

  it("has only the two states that can be true today", () => {
    // "Waiting on them" and "Answered" both mean we replied, and the ERP has
    // never sent anything - it holds Mail.Read. A chip that can only read zero
    // teaches people to stop reading the chips.
    const states = new Set([stateOf([open]), stateOf([committed]), stateOf([])]);
    expect([...states].sort()).toEqual(["closed", "needsReply"]);
  });
});
