"use client";

/** Figma: component set `Toggle` on page v5 — On | Off | Disabled. 34x20, 16px knob. */
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  const track = disabled ? "bg-line" : checked ? "bg-ink" : "bg-line-strong";
  const knob = disabled ? "bg-disabled" : "bg-surface";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-5 w-[34px] items-center rounded-[var(--radius-pill)] p-0.5 transition-colors ${track}`}
    >
      <span
        className={`size-4 rounded-full transition-transform ${knob} ${checked ? "translate-x-3.5" : ""}`}
      />
    </button>
  );
}
