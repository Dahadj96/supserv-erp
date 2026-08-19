import type { ReactNode } from "react";

/**
 * Screen 34 — empty, loading and error states.
 *
 * Every one of them says what happened and what to do next. "Could not load"
 * carries "Nothing was changed", because after a failed request the first
 * question a person has is whether they broke something.
 */
export function StateBlock({
  tone = "empty",
  title,
  body,
  action,
}: {
  tone?: "empty" | "error" | "permission";
  title: string;
  body: string;
  action?: ReactNode;
}) {
  const accent =
    tone === "error"
      ? "border-critical-bg bg-critical-bg"
      : tone === "permission"
        ? "border-warning-bg bg-warning-bg"
        : "border-line bg-card";

  return (
    <div className={`rounded-[var(--radius-card)] border px-6 py-14 text-center ${accent}`}>
      <h2 className="text-lead font-semibold text-ink">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-[460px] text-tiny leading-relaxed text-secondary">
        {body}
      </p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** The skeleton every list shows while its first page is in flight. */
export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="animate-pulse rounded-[var(--radius-card)] border border-line bg-surface">
      {Array.from({ length: rows }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder rows
          key={i}
          className="flex items-center gap-3 border-b border-line-subtle px-4 py-3 last:border-0"
        >
          <span className="h-3 w-24 rounded bg-inactive" />
          <span className="h-3 w-40 rounded bg-inactive" />
          <span className="h-3 flex-1 rounded bg-inactive" />
          <span className="h-3 w-16 rounded bg-inactive" />
        </div>
      ))}
    </div>
  );
}
