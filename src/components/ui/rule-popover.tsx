"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { RuleResult } from "@/domain/rules";

/**
 * Screen 80 — no grey button without a reason. This is the popover: it names
 * the rule, its authority, and where to go and fix it. An unconfirmed rule is
 * shown as a warning, because the system never asserts a law on its own
 * authority (CLAUDE.md, hard rules).
 */
export function RulePopover({
  results,
  children,
}: {
  results: RuleResult[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations();

  if (results.length === 0) return <>{children}</>;

  return (
    <span className="relative inline-flex">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a disabled control
          fires no events of its own, so the reason has to be surfaced by a
          wrapper. Focus handlers and tabIndex keep it reachable by keyboard. */}
      <span
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>
      {open ? (
        <div
          role="tooltip"
          className="absolute end-0 top-full z-10 mt-1.5 w-[320px] rounded-[var(--radius-card)] border border-line bg-surface p-3 text-start shadow-sm"
        >
          <ul className="flex flex-col gap-2.5">
            {results.map((r) => (
              <li key={r.code}>
                <p className="text-tiny font-medium text-ink">{t(r.messageKey)}</p>
                {r.authority ? (
                  <p className="text-micro text-muted">
                    {t("rules.authority", { authority: r.authority })}
                  </p>
                ) : null}
                {r.severity === "warn" ? (
                  <p className="mt-1 rounded-[var(--radius-control)] bg-warning-bg px-1.5 py-1 text-micro text-warning-ink">
                    {t("rules.unconfirmed")}
                  </p>
                ) : null}
                {r.fixRoute ? (
                  <p className="mt-1 text-micro font-medium text-accent-ink">{r.fixRoute}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </span>
  );
}
