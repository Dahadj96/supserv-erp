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
      {/*
        24px under a thumb, the drawn 15px under a mouse. A tick box is the
        smallest thing anybody is asked to hit in a list of twenty-five rows,
        and 15px is about a third of a fingertip — the same reasoning as the
        nav rows, which are 40px on a phone and 30 on a laptop.
      */}
      <span className="relative inline-flex size-6 items-center justify-center md:size-[15px]">
        <input
          id={inputId}
          type="checkbox"
          {...props}
          className="peer size-6 appearance-none rounded-[4px] border border-line-strong bg-surface checked:border-ink checked:bg-ink disabled:border-line disabled:bg-inactive md:size-[15px]"
        />
        <Check
          className="pointer-events-none absolute size-4 text-on-ink opacity-0 peer-checked:opacity-100 md:size-2.5"
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
