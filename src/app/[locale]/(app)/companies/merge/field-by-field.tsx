import type { ReactNode } from "react";

/**
 * Screen 84 — the two columns.
 *
 * These are plain radio inputs. The whole screen works with JavaScript turned
 * off, because it has to: a merge is the one action in Phase 1 that cannot be
 * repeated to recover from a half-submitted form.
 *
 * The dot and the border are driven by `:checked` in CSS rather than by React
 * state, which is why nothing here is a client component.
 */
export function Choice({
  field,
  side,
  value,
  checked,
}: {
  field: string;
  side: "kept" | "retired";
  value: ReactNode;
  checked: boolean;
}) {
  const id = `${field}-${side}`;
  return (
    <label
      htmlFor={id}
      className="flex min-h-[34px] cursor-pointer items-center gap-2.5 rounded-[var(--radius-control)] border border-line bg-plane px-3 py-2 text-tiny text-muted transition-colors has-[:checked]:border-ink has-[:checked]:bg-surface has-[:checked]:text-ink"
    >
      <input
        id={id}
        type="radio"
        name={`choice.${field}`}
        value={side}
        defaultChecked={checked}
        className="peer sr-only"
      />
      <span className="size-2 shrink-0 rounded-full border border-line-strong peer-checked:border-ink peer-checked:bg-ink" />
      <span className="truncate">{value}</span>
    </label>
  );
}

/** Aliases are never a choice, so this box is always on and has no input. */
export function Kept({ value }: { value: ReactNode }) {
  return (
    <div className="flex min-h-[34px] items-center gap-2.5 rounded-[var(--radius-control)] border border-ink bg-surface px-3 py-2 text-tiny text-ink">
      <span className="size-2 shrink-0 rounded-full border border-ink bg-ink" />
      <span className="truncate">{value}</span>
    </div>
  );
}

export function FieldRow({
  label,
  note,
  children,
}: {
  label: string;
  note?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="mb-3.5 last:mb-0">
      <p className="mb-1 text-micro font-medium text-secondary">{label}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
      {note ? <p className="mt-1 text-micro leading-relaxed text-muted">{note}</p> : null}
    </div>
  );
}
