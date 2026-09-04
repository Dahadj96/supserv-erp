"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Link, usePathname } from "@/i18n/navigation";
import { NAV_GROUPS } from "./nav-items";

/**
 * The twenty-four destinations, drawn once.
 *
 * The rail (laptop) and the phone drawer show the same list, and they show it
 * from this file rather than each keeping its own copy — a second copy is a
 * second place for "active" to be decided differently, and the first thing
 * that drifts is which row is highlighted.
 *
 * Counts are placeholders until the queries exist — LAW 1 says they are
 * computed, never stored, so they will arrive from the server, not a column.
 */
const COUNTS: Record<string, { value: number; tone: "neutral" | "critical" }> = {
  today: { value: 7, tone: "neutral" },
  inbox: { value: 12, tone: "critical" },
  conversations: { value: 9, tone: "critical" },
};

export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <>
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
                onClick={onNavigate}
                // 40px tall on a phone, 30 on a laptop: a finger is not a
                // mouse pointer, and the same list serves both.
                className={`mb-px flex items-center gap-2.5 rounded-[var(--radius-control)] py-2.5 pe-2 ps-2.5 md:py-1.5 ${
                  active
                    ? "bg-ink font-semibold text-on-ink"
                    : "font-medium text-secondary hover:bg-sunken"
                }`}
              >
                <entry.icon className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{t(entry.messageKey)}</span>
                {count ? (
                  <span className="ms-auto">
                    {/* On the active row the pill sits on ink, so a solid ink
                        pill would vanish — the soft chip is the readable one. */}
                    <Badge tone={active ? "neutral" : count.tone} fill={active ? "soft" : "solid"}>
                      {count.value}
                    </Badge>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}
