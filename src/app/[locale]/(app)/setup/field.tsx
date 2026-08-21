import type { ReactNode } from "react";

export const INPUT =
  "h-[34px] w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-tiny outline-none placeholder:text-muted focus:border-ink";

/** Shared by the four Day-one forms. Required is marked, never implied. */
export function Field({
  htmlFor,
  label,
  hint,
  required,
  children,
}: {
  htmlFor: string;
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-micro font-medium text-secondary">
        {label}
        {required ? <span className="text-critical"> *</span> : null}
      </label>
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 text-micro leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}
