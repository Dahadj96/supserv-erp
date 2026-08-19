import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Figma: component set `Button` on page v5.
 * Style=Primary | Secondary | Ghost | Danger.
 *
 * LAW — every disabled control resolves to a rule code. `disabledReason` is not
 * decoration: if the button is disabled, the caller must say why, and that text
 * comes from `src/domain/rules.ts`, never from a component.
 */
export type ButtonStyle = "primary" | "secondary" | "ghost" | "danger";

const STYLES: Record<ButtonStyle, string> = {
  primary: "bg-ink text-on-ink hover:bg-ink-hover",
  secondary: "bg-surface text-ink border border-line hover:bg-sunken focus-visible:border-ink",
  ghost: "text-secondary hover:bg-sunken",
  danger: "bg-critical text-on-ink hover:brightness-95",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonStyle;
  size?: "default" | "small";
  icon?: ReactNode;
  disabledReason?: string;
};

export function Button({
  variant = "secondary",
  size = "default",
  icon,
  disabledReason,
  children,
  className = "",
  ...props
}: Props) {
  const isDisabled = props.disabled === true || disabledReason !== undefined;
  const sizing = size === "small" ? "px-2.5 py-1.5 text-small" : "px-3.5 py-2 text-base";

  return (
    <button
      type="button"
      {...props}
      // aria-disabled rather than disabled: a `disabled` button fires no events
      // and cannot take focus, so nobody could ever read the reason it is grey.
      aria-disabled={isDisabled || undefined}
      onClick={isDisabled ? undefined : props.onClick}
      title={disabledReason}
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-control)] font-medium transition-colors ${sizing} ${
        isDisabled ? "bg-inactive text-disabled cursor-not-allowed" : STYLES[variant]
      } ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}
