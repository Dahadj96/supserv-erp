import { describe, expect, it } from "vitest";
import {
  type ApprovalRequest,
  BEHAVIOUR,
  checkDecision,
  checkRequest,
  DEFAULT_GATES,
  type Gate,
  type GateCode,
  isImpossible,
  isSelfApproval,
  waitingFor,
} from "@/domain/approval/gates";

/**
 * Screen 65 — Approvals.
 *
 *   "The audit log records what happened. These rules stop it happening until
 *    someone with the authority agrees. Different jobs — the system needs both."
 *
 * And the card that answers the objection this company will actually raise:
 *
 *   "If you are the Gérant and the Commercial at once, these gates cost you a
 *    click each. Keep them anyway. The value is not the second person — it is
 *    that six months later the audit log says why the margin was 11.4% on that
 *    job, and you are not reconstructing it from memory."
 *
 * That paragraph is why `isSelfApproval` returns true and permits, rather than
 * refusing. A gate that refused self-approval in a company of one would be a
 * gate somebody routes around by not asking — and not asking loses the record
 * entirely, which is the only thing the gate was ever for.
 */

const gate = (over: Partial<Gate> & { code: GateCode }): Gate => ({
  role: "gerant",
  threshold: null,
  requiresReasonCode: true,
  requiresJustification: true,
  enabled: true,
  position: 1,
  ...over,
});

const request = (over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id: "r1",
  gateCode: "offer.marginBelowFloor",
  entity: "document",
  entityId: "d1",
  subject: "Margin below the floor on SUP/OFF/2026/0113",
  before: { margin: "17.2%", totalExcl: "1384858" },
  after: { margin: "11.4%", totalExcl: "1302100" },
  reasonCode: "matchCompetitor",
  justification: "TouatGaz told us a competitor is at 1 310 000.",
  requestedBy: "gourari",
  requestedAt: new Date("2026-08-19T08:52:00Z"),
  status: "waiting",
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  selfApproved: false,
  ...over,
});

describe("the nine gates", () => {
  it("has the frame's nine, in the frame's order", () => {
    expect(DEFAULT_GATES.map((g) => g.code)).toEqual([
      "offer.marginBelowFloor",
      "offer.discountAbove",
      "sourcing.notCheapest",
      "offer.termsBeyond",
      "deal.noBidAbove",
      "client.blockedForDebt",
      "document.creditNote",
      "invoice.writeOff",
      "document.changeIssued",
    ]);
  });

  it("carries the frame's thresholds", () => {
    const find = (code: GateCode) => DEFAULT_GATES.find((g) => g.code === code);
    expect(find("offer.marginBelowFloor")?.threshold).toBe(15);
    expect(find("offer.discountAbove")?.threshold).toBe(8);
    expect(find("offer.termsBeyond")?.threshold).toBe(60);
    expect(find("deal.noBidAbove")?.threshold).toBe(1_000_000);
  });

  it("marks changing an issued document as approvable by nobody", () => {
    // Not a permission nobody happens to hold. LAW 5 is structural — there is
    // no code path that edits an issued document — and a gate that could be
    // approved would imply there is one.
    const impossible = DEFAULT_GATES.find((g) => g.code === "document.changeIssued");
    expect(isImpossible(impossible as Gate)).toBe(true);
    expect(DEFAULT_GATES.filter(isImpossible)).toHaveLength(1);
  });

  it("names a role, never a person", () => {
    // A gate naming Y. Gourari personally is a gate that breaks when he leaves.
    for (const g of DEFAULT_GATES) expect(g.role).toMatch(/^[a-z]+$/);
  });
});

describe("asking for permission", () => {
  it("lets a complete request through", () => {
    expect(
      checkRequest({
        gate: gate({ code: "offer.marginBelowFloor" }),
        reasonCode: "matchCompetitor",
        justification: "A competitor is at 1 310 000.",
      }),
    ).toBeNull();
  });

  it("refuses a request with no reason code", () => {
    expect(
      checkRequest({
        gate: gate({ code: "offer.marginBelowFloor" }),
        reasonCode: "  ",
        justification: "because",
      }),
    ).toBe("reasonCodeRequired");
  });

  it("refuses a request with no sentence in their own words", () => {
    // A reason code alone reads "match a competitor" and answers nothing six
    // months later. The sentence is the whole point.
    expect(
      checkRequest({
        gate: gate({ code: "offer.marginBelowFloor" }),
        reasonCode: "matchCompetitor",
        justification: null,
      }),
    ).toBe("justificationRequired");
  });

  it("refuses at the ASK for something nobody could ever approve", () => {
    // Refusing at the decision instead would leave somebody waiting a day for
    // an answer that was never possible.
    expect(
      checkRequest({
        gate: gate({ code: "document.changeIssued", role: "nobody" }),
        reasonCode: "x",
        justification: "y",
      }),
    ).toBe("notApprovable");
  });

  it("refuses a gate that has been switched off, and one that never existed", () => {
    expect(
      checkRequest({
        gate: gate({ code: "invoice.writeOff", enabled: false }),
        reasonCode: "a",
        justification: "b",
      }),
    ).toBe("gateDisabled");
    expect(checkRequest({ gate: undefined, reasonCode: "a", justification: "b" })).toBe(
      "gateNotFound",
    );
  });

  it("waives both when a gate asks for neither", () => {
    expect(
      checkRequest({
        gate: gate({
          code: "invoice.writeOff",
          requiresReasonCode: false,
          requiresJustification: false,
        }),
        reasonCode: null,
        justification: null,
      }),
    ).toBeNull();
  });
});

describe("deciding", () => {
  const g = gate({ code: "offer.marginBelowFloor", role: "gerant" });

  it("lets the role holder decide", () => {
    expect(checkDecision({ gate: g, request: request(), role: "gerant" })).toBeNull();
  });

  it("refuses anybody else", () => {
    expect(checkDecision({ gate: g, request: request(), role: "commercial" })).toBe(
      "notYourDecision",
    );
    expect(checkDecision({ gate: g, request: request(), role: null })).toBe("notYourDecision");
  });

  it("refuses a second decision on the same request", () => {
    expect(
      checkDecision({ gate: g, request: request({ status: "approved" }), role: "gerant" }),
    ).toBe("alreadyDecided");
  });

  it("allows self-approval, and marks it", () => {
    // The whole point of the "one person is the company" card. Allowed, because
    // refusing teaches somebody to stop asking; marked, because the record is
    // the value.
    expect(checkDecision({ gate: g, request: request(), role: "gerant" })).toBeNull();
    expect(isSelfApproval(request(), "gourari")).toBe(true);
    expect(isSelfApproval(request(), "dahadj")).toBe(false);
  });
});

describe("the waiting list", () => {
  const gates = [
    gate({ code: "offer.marginBelowFloor", role: "gerant" }),
    gate({ code: "sourcing.notCheapest", role: "commercial" }),
  ];
  const rows = [
    request({ id: "b", requestedAt: new Date("2026-08-19T08:52:00Z") }),
    request({
      id: "a",
      gateCode: "sourcing.notCheapest",
      requestedAt: new Date("2026-08-18T16:20:00Z"),
    }),
    request({ id: "done", status: "approved", decidedBy: "x", decidedAt: new Date() }),
  ];

  it("shows only what is still waiting, oldest first", () => {
    const view = waitingFor(rows, gates, "gerant");
    expect(view.requests.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("shows everybody everything, and counts only what is theirs", () => {
    // A Commercial should see their own request sitting there and how long it
    // has sat. Hiding the row would leave them wondering whether they ever
    // asked. Only the buttons are gated.
    const asGerant = waitingFor(rows, gates, "gerant");
    const asCommercial = waitingFor(rows, gates, "commercial");
    expect(asGerant.requests).toHaveLength(2);
    expect(asCommercial.requests).toHaveLength(2);
    expect(asGerant.mine).toBe(1);
    expect(asCommercial.mine).toBe(1);
  });

  it("counts none as mine when nobody has given me a role", () => {
    expect(waitingFor(rows, gates, null).mine).toBe(0);
  });
});

describe("how a gate behaves", () => {
  it("blocks rather than warns", () => {
    // The difference matters more than it sounds: a warning is a thing people
    // learn to click past, and a system full of warnings nobody reads is
    // indistinguishable from a system with no rules at all.
    expect(BEHAVIOUR.theAction).toBe("blockedNotWarned");
  });

  it("keeps the draft when a request is declined", () => {
    expect(BEHAVIOUR.theDraft).toBe("savedAndKept");
    expect(BEHAVIOUR.ifDeclined).toBe("draftStaysNothingLost");
  });

  it("attributes and timestamps every decision", () => {
    expect(BEHAVIOUR.decision).toBe("timestampedAndAttributed");
  });
});
