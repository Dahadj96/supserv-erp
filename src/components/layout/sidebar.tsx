"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Link, usePathname } from "@/i18n/navigation";
import { NAV_GROUPS } from "./nav-items";

/**
 * Figma: component `Sidebar` on page v5, which 79 screens instance.
 * 236px rail, user footer pinned to the bottom by the growing filler.
 *
 * Counts are placeholders until the queries exist — law 1 says they are
 * computed, never stored, so they will arrive from the server, not a column.
 */
const COUNTS: Record<string, { value: number; tone: "neutral" | "critical" }> = {
  today: { value: 7, tone: "neutral" },
  inbox: { value: 12, tone: "critical" },
  conversations: { value: 9, tone: "critical" },
};

export function Sidebar() {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <aside className="flex w-[236px] shrink-0 flex-col border-e border-line-subtle bg-surface">
      <div className="flex h-[59px] items-center gap-3 ps-4">
        <span className="flex size-7 items-center justify-center rounded-[var(--radius-control)] bg-ink text-on-ink text-tiny font-semibold">
          S
        </span>
        <span className="leading-tight">
          <span className="block text-lead font-semibold text-ink">SUPSERV</span>
          <span className="block text-micro text-muted">SARL</span>
        </span>
      </div>

      <nav className="px-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.messageKey ?? "primary"}>
            {group.messageKey ? (
              <p className="px-2.5 pt-3 pb-1 text-micro font-medium tracking-wide text-muted">
                {t(group.messageKey)}
              </p>
            ) : null}
            {group.entries.map((entry) => {
              const active = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
              const count = entry.badge ? COUNTS[entry.badge] : undefined;
              return (
                <Link
                  key={entry.key}
                  href={entry.href}
                  aria-current={active ? "page" : undefined}
                  className={`mb-px flex items-center gap-2.5 rounded-[var(--radius-control)] py-1.5 pe-2 ps-2.5 ${
                    active
                      ? "bg-ink font-semibold text-on-ink"
                      : "font-medium text-secondary hover:bg-sunken"
                  }`}
                >
                  <entry.icon className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{t(entry.messageKey)}</span>
                  {count ? (
                    <span className="ms-auto">
                      <Badge tone={active ? "neutral" : count.tone}>{count.value}</Badge>
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* the filler — this is what pins the footer to the bottom */}
      <div className="flex-1" />

      <div className="flex h-[55px] items-center gap-3 border-t border-line-subtle ps-4">
        <span className="flex size-[30px] items-center justify-center rounded-full bg-chip text-tiny font-semibold text-secondary">
          AD
        </span>
        <span className="leading-tight">
          <span className="block text-tiny font-medium text-ink">A. Dahadj</span>
          <span className="block text-micro text-muted">Gérant</span>
        </span>
      </div>
    </aside>
  );
}
