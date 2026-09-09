import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CheckState } from "@/domain/offer/submit";
import { Link } from "@/i18n/navigation";

/**
 * A run, numbered, with the state of each step computed.
 *
 * Screen 85 built this shape for day one — "eleven things to set before the
 * first document can be issued", numbered rows, done ones with a green badge
 * and no button, the one that is holding everything up with a primary button —
 * and task 2.6 is the observation that it is the right shape for the two runs
 * this company actually works: the enquiry (screen 06) and the tender folder
 * (screen 08). This is that markup, once, so the three cannot drift.
 *
 * NOTHING HERE IS STORED, on any of the three screens (LAW 1). A step is done
 * when the thing it asks for exists, and it reopens the day that stops being
 * true. There is no `progress` column and there must not be one: a stored flag
 * is a flag that survives somebody deleting the thing it was about.
 *
 * The component takes RESOLVED strings rather than message keys, because each
 * screen keys its sentences under its own prefix and a component that built the
 * key itself would be a component that decides what a screen is called.
 *
 * WHICH STEP GETS THE PRIMARY BUTTON is computed here rather than passed: it is
 * the first one that has not passed, which is the same rule `nextStep` applies
 * to pick the line above the list. Two places deciding it independently is how
 * the header names one step and the list highlights another.
 */

const TONE: Record<CheckState, "good" | "warning" | "critical" | "neutral"> = {
  pass: "good",
  warn: "warning",
  block: "critical",
  note: "neutral",
};

export type StepRow = {
  key: string;
  state: CheckState;
  /** What the step is, in the reader's language. */
  label: string;
  /** The sentence under it — what is true right now. */
  detail?: string;
  /** Where the button goes. Absent when no single screen does it. */
  href?: string;
  /** The button's words. Absent means no button, even with an href. */
  action?: string;
};

export function Stepper({
  steps,
  title,
  aside,
  lead,
  doneLabel,
  stateLabel,
}: {
  steps: StepRow[];
  title: string;
  /** "5 of 9", or where the numbers come from. Printed at the end of the head. */
  aside?: string;
  /**
   * One line above the list: the thing actually waiting on somebody.
   *
   * Screen 06 had this before it had a stepper (task 2.5) and it is the half
   * people read — a person opening an enquiry wants one sentence, and the
   * numbered rows under it are where they look when the sentence is not enough.
   */
  lead?: string;
  /** The green badge on a step that is done. */
  doneLabel: string;
  /** Words for `warn`, `block` and `note` — a badge for a step with no button. */
  stateLabel: (state: CheckState) => string;
}) {
  const current = steps.findIndex((step) => step.state !== "pass");

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface">
      <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
        <h2 className="text-tiny font-semibold text-ink">{title}</h2>
        {aside ? <span className="ms-auto text-micro text-muted">{aside}</span> : null}
      </div>

      {lead ? (
        <p className="border-b border-line-subtle px-5 py-3 text-tiny leading-relaxed text-ink">
          {lead}
        </p>
      ) : null}

      <ol>
        {steps.map((step, i) => {
          const isCurrent = i === current;
          return (
            <li
              key={step.key}
              className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3 last:border-0"
            >
              {/*
                The number is the step's place in the RUN, so it is the index in
                this list and not a key looked up somewhere — a run that skipped
                from 4 to 6 because a step did not apply would be a run nobody
                could follow.
              */}
              <span
                className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full text-micro font-semibold ${
                  step.state === "pass"
                    ? "border border-line text-muted"
                    : isCurrent
                      ? "bg-ink text-on-ink"
                      : "border border-line text-secondary"
                }`}
              >
                {i + 1}
              </span>

              <div className="min-w-0 flex-1">
                <p className={`text-tiny ${step.state === "pass" ? "text-secondary" : "text-ink"}`}>
                  {step.label}
                </p>
                {step.detail ? (
                  <p className="mt-0.5 text-micro leading-relaxed text-muted">{step.detail}</p>
                ) : null}
              </div>

              <span className="ms-auto shrink-0">
                {step.state === "pass" ? (
                  <Badge tone="good">{doneLabel}</Badge>
                ) : step.href && step.action ? (
                  <Link href={step.href}>
                    <Button variant={isCurrent ? "primary" : "secondary"} size="small">
                      {step.action}
                    </Button>
                  </Link>
                ) : (
                  // No screen does this one. The badge says what is true rather
                  // than offering a button that would land somewhere wrong —
                  // screen 06's missing deadline and its uninvoiced order are
                  // both this case, and both are named under Known gaps.
                  <Badge tone={TONE[step.state]}>{stateLabel(step.state)}</Badge>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
