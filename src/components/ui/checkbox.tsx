import { Check } from "lucide-react";
import { type InputHTMLAttributes, useId } from "react";

/**
 * Figma: component set `Checkbox` on page v5 — Unchecked | Checked | Disabled.
 *
 * The input is NOT nested inside the label. A nested input receives the click
 * twice — once directly, once from the label's activation behaviour — which
 * toggles and untoggles, so clicking the box itself appears to do nothing.
 * `id` + `htmlFor` keeps one click, one toggle.
 */
export function Checkbox({
  label,
  className = "",
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const generated = useId();
  const inputId = id ?? generated;

  return (
    <span
      className={`inline-flex items-center gap-2 ${props.disabled ? "text-disabled" : "text-ink"} ${className}`}
    >
      <span className="relative inline-flex size-[15px] items-center justify-center">
        <input
          id={inputId}
          type="checkbox"
          {...props}
          className="peer size-[15px] appearance-none rounded-[4px] border border-line-strong bg-surface checked:border-ink checked:bg-ink disabled:border-line disabled:bg-inactive"
        />
        <Check
          className="pointer-events-none absolute size-2.5 text-on-ink opacity-0 peer-checked:opacity-100"
          aria-hidden
        />
      </span>
      {label ? (
        <label htmlFor={inputId} className="text-tiny">
          {label}
        </label>
      ) : null}
    </span>
  );
}
