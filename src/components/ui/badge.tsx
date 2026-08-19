import type { ReactNode } from "react";

/** Figma: component set `Badge` on page v5 — Tone=Neutral | Tone=Critical. */
export type BadgeTone = "neutral" | "critical";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-ink text-on-ink",
  critical: "bg-critical text-on-ink",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-pill)] px-1.5 py-0.5 text-micro font-semibold leading-none ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
