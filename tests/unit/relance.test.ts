import { describe, expect, it } from "vitest";
import {
  awaitingApproval,
  DEFAULT_POLICY,
  dueNow,
  type RelanceRecord,
  readyToSend,
  shouldWarnBeforeQuoting,
} from "@/domain/money/relance";

/**
 * Screen 20 — the relance policy.
 *
 * The screen states the contract in one line and this file keeps it: "The
 * policy fires the reminders; a person still approves anything that escalates."
 *
 * So every function here COMPUTES what is owed a chase. Nothing sends, drafts
 * or writes. LAW 6, and the safety rail NEVER_AUTO_REPLY.
 */

const TODAY = new Date(Date.UTC(2026, 7, 18));
const day = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d));

let n = 0;
function record(over: Partial<RelanceRecord> = {}): RelanceRecord {
  n += 1;
  return {
    id: `r${n}`,
    stepKey: "reminder1",
    channel: "email",
    status: "sent",
    sentAt: day(7, 15),
    promisedOn: null,
    ...over,
  };
}

const ask = (over: Partial<Parameters<typeof dueNow>[0]> = {}) =>
  dueNow({
    dueOn: day(5, 12),
    balance: "5640000",
    policy: DEFAULT_POLICY,
    history: [],
    today: TODAY,
    ...over,
  });

describe("what chase is due", () => {
  it("proposes the first reminder seven days after the due date", () => {
    const due = ask({ dueOn: day(8, 10) });
    expect(due?.step.key).toBe("reminder1");
    expect(due?.daysLate).toBe(1);
    expect(due?.needsApproval).toBe(false);
  });

  it("proposes nothing before the first step is reached", () => {
    expect(ask({ dueOn: day(8, 15) })).toBeNull();
  });

  it("proposes ONE step, not every step that is technically overdue", () => {
    // 98 days late with nothing done. Three steps are due; sending three emails
    // in a morning is how a client stops reading any of them.
    const due = ask();
    expect(due?.step.key).toBe("reminder1");
  });

  it("moves to the next step once the last one was actually sent", () => {
    const due = ask({ history: [record({ stepKey: "reminder1", status: "sent" })] });
    expect(due?.step.key).toBe("reminder2");
  });

  it("does not count a draft as a chase", () => {
    // Screen 20 shows a mise en demeure prepared and "not sent — awaiting your
    // approval". The client has heard nothing, so the step is still due — and
    // the screen is told a draft already exists rather than making a second one.
    const due = ask({ history: [record({ stepKey: "reminder1", status: "draft" })] });
    expect(due?.step.key).toBe("reminder1");
    expect(due?.drafted).toBe(true);
  });
});

describe("when the policy stays quiet", () => {
  it("stops chasing a paid invoice", () => {
    expect(ask({ balance: "0" })).toBeNull();
    // Also covers a credit note and a written-off invoice: no balance, no chase.
    expect(ask({ balance: "-100" })).toBeNull();
  });

  it("stops chasing when nobody recorded a due date", () => {
    expect(ask({ dueOn: null })).toBeNull();
  });

  it("respects a date the client promised", () => {
    // Screen 20: "Promised payment week of 11 Aug". Chasing again before that
    // date is how a business becomes the one nobody takes calls from.
    const promised = ask({
      history: [record({ status: "replied", promisedOn: day(8, 25) })],
    });
    expect(promised).toBeNull();
  });

  it("resumes once the promised date has passed", () => {
    const broken = ask({
      history: [record({ stepKey: "reminder1", status: "replied", promisedOn: day(8, 11) })],
    });
    expect(broken?.step.key).toBe("reminder2");
  });

  it("stops proposing once every step has been done", () => {
    // The policy is exhausted. What happens next is a person's decision, and
    // the system stops suggesting.
    const exhausted = ask({
      history: DEFAULT_POLICY.map((s) => record({ stepKey: s.key, status: "sent" })),
    });
    expect(exhausted).toBeNull();
  });

  it("skips a step somebody switched off in settings", () => {
    const noPhone = DEFAULT_POLICY.map((s) =>
      s.key === "reminder1" || s.key === "reminder2" ? { ...s, enabled: false } : s,
    );
    expect(ask({ policy: noPhone })?.step.key).toBe("phone");
  });
});

describe("nothing escalates without a person", () => {
  it("marks the mise en demeure as needing approval", () => {
    // A formal notice under Algerian commercial practice, and the first step
    // towards court. An automated one over a fortnight's delay would cost more
    // than the invoice it was chasing.
    const due = ask({
      history: ["reminder1", "reminder2", "phone"].map((k) => record({ stepKey: k })),
    });
    expect(due?.step.key).toBe("mise_en_demeure");
    expect(due?.needsApproval).toBe(true);
  });

  it("counts what can be sent apart from what must be approved", () => {
    const invoices = [
      { documentId: "a", due: ask({ dueOn: day(8, 10) }) },
      {
        documentId: "b",
        due: ask({
          history: ["reminder1", "reminder2", "phone"].map((k) => record({ stepKey: k })),
        }),
      },
      { documentId: "c", due: null },
    ];

    expect(readyToSend(invoices).map((i) => i.documentId)).toEqual(["a"]);
    expect(awaitingApproval(invoices).map((i) => i.documentId)).toEqual(["b"]);
  });

  it("never puts a block step on the send list", () => {
    // "Stop new offers" is not a message to the client. Sending it would be
    // sending nothing to nobody.
    const blocked = [
      {
        documentId: "d",
        // Due 1 March, so 170 days late — past the 120-day threshold that
        // `stop_offers` sits at. Everything before it has been done.
        due: ask({
          dueOn: day(3, 1),
          history: DEFAULT_POLICY.filter((s) => s.key !== "stop_offers").map((s) =>
            record({ stepKey: s.key }),
          ),
        }),
      },
    ];
    expect(blocked[0]?.due?.step.key).toBe("stop_offers");
    expect(readyToSend(blocked)).toEqual([]);
  });
});

describe("stop new offers — the step with teeth", () => {
  it("warns before quoting a client who has owed money for four months", () => {
    const verdict = shouldWarnBeforeQuoting({
      owed: [
        { dueOn: day(3, 1), balance: "5640000" },
        { dueOn: day(8, 10), balance: "100000" },
      ],
      policy: DEFAULT_POLICY,
      today: TODAY,
    });
    expect(verdict.warn).toBe(true);
    expect(verdict.oldestDays).toBe(170);
    // Only what is past the threshold counts towards the figure quoted.
    expect(verdict.total).toBe("5640000.00");
  });

  it("says nothing about a client who is merely a bit late", () => {
    const verdict = shouldWarnBeforeQuoting({
      owed: [{ dueOn: day(7, 20), balance: "100000" }],
      policy: DEFAULT_POLICY,
      today: TODAY,
    });
    expect(verdict.warn).toBe(false);
  });

  it("warns and does not refuse", () => {
    // The Gérant may have very good reasons to quote a client who is late, and
    // a system that refuses on his behalf is a system he works around. LAW 6 —
    // there is no `blocked` in what this returns.
    const verdict = shouldWarnBeforeQuoting({
      owed: [{ dueOn: day(1, 1), balance: "9000000" }],
      policy: DEFAULT_POLICY,
      today: TODAY,
    });
    expect(Object.keys(verdict).sort()).toEqual(["oldestDays", "total", "warn"]);
  });

  it("says nothing when the step is switched off", () => {
    const off = DEFAULT_POLICY.map((s) => (s.key === "stop_offers" ? { ...s, enabled: false } : s));
    expect(
      shouldWarnBeforeQuoting({
        owed: [{ dueOn: day(1, 1), balance: "9000000" }],
        policy: off,
        today: TODAY,
      }).warn,
    ).toBe(false);
  });
});
