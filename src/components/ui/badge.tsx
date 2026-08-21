import type { ReactNode } from "react";

/**
 * Figma: component set `Badge` on page v5 has Tone=Neutral and Tone=Critical,
 * both solid. The v4 screens draw more than that — screen 76 alone uses a soft
 * green, a soft amber, a soft red, a soft blue and a soft orange — and CLAUDE.md
 * says the screen wins. So the component keeps the two solid tones it had and
 * gains the fill the screens actually use.
 *
 * `fill` is soft by default because that is what nearly every screen draws. The
 * solid pair is the exception: a count in the sidebar, a countdown in the bin.
 */
export type BadgeTone = "neutral" | "good" | "warning" | "serious" | "critical" | "accent";
export type BadgeFill = "soft" | "solid";

const SOFT: Record<BadgeTone, string> = {
  neutral: "bg-chip text-secondary",
  good: "bg-good-bg text-good-ink",
  warning: "bg-warning-bg text-warning-ink",
  serious: "bg-serious-bg text-serious-ink",
  critical: "bg-critical-bg text-critical-ink",
  accent: "bg-accent-bg text-accent-ink",
};

const SOLID: Record<BadgeTone, string> = {
  neutral: "bg-ink text-on-ink",
  good: "bg-good text-on-ink",
  warning: "bg-warning text-ink",
  serious: "bg-serious text-on-ink",
  critical: "bg-critical text-on-ink",
  accent: "bg-accent text-on-ink",
};

export function Badge({
  tone = "neutral",
  fill = "soft",
  children,
}: {
  tone?: BadgeTone;
  fill?: BadgeFill;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-pill)] px-1.5 py-0.5 text-micro font-semibold leading-none ${
        fill === "solid" ? SOLID[tone] : SOFT[tone]
      }`}
    >
      {children}
    </span>
  );
}
