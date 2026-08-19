import { Check } from "lucide-react";
import type { InputHTMLAttributes } from "react";

/** Figma: component set `Checkbox` on page v5 — Unchecked | Checked | Disabled. */
export function Checkbox({
  label,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label
      className={`inline-flex items-center gap-2 ${props.disabled ? "text-disabled" : "text-ink"} ${className}`}
    >
      <span className="relative inline-flex size-[15px] items-center justify-center">
        <input
          type="checkbox"
          {...props}
          className="peer size-[15px] appearance-none rounded-[4px] border border-line-strong bg-surface checked:border-ink checked:bg-ink disabled:border-line disabled:bg-inactive"
        />
        <Check
          className="pointer-events-none absolute size-2.5 text-on-ink opacity-0 peer-checked:opacity-100"
          aria-hidden
        />
      </span>
      {label ? <span className="text-tiny">{label}</span> : null}
    </label>
  );
}
