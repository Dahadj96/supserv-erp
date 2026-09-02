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

export function Sidebar({ displayName, roleLabel }: { displayName: string; roleLabel: string }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const initials = displayName
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    // Hidden below `md`. Screen 86: the rail is a laptop object — twenty-eight
    // destinations on a 390px screen is a menu, and a menu is what people stop
    // opening. On a phone the four jobs live in the bottom bar instead.
    <aside className="hidden w-[236px] shrink-0 flex-col border-e border-line-subtle bg-surface md:flex">
      <div className="flex h-[59px] items-center gap-3 ps-4">
        <span className="flex size-7 items-center justify-center rounded-[var(--radius-control)] bg-ink text-on-ink text-tiny font-semibold">
          S
        </span>
        <span className="leading-tight">
          <span className="block text-lead font-semibold text-ink">SUPSERV</span>
          <span className="block text-micro text-muted">SARL</span>
        </span>
      </div>

      {/*
        Scrolls on its own. Twenty-eight destinations do not fit in the 768
        pixels of a 12-inch laptop, and before this the rail simply ran off the
        bottom of an `h-screen` shell — Conformité, Rapports and Paramètres were
        below an edge nothing could scroll past. The footer stays pinned.
      */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
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
                      {/* On the active row the pill sits on ink, so a solid ink
                          pill would vanish — the soft chip is the readable one. */}
                      <Badge
                        tone={active ? "neutral" : count.tone}
                        fill={active ? "soft" : "solid"}
                      >
                        {count.value}
                      </Badge>
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex h-[55px] shrink-0 items-center gap-3 border-t border-line-subtle ps-4">
        <span className="flex size-[30px] items-center justify-center rounded-full bg-chip text-tiny font-semibold text-secondary">
          {initials}
        </span>
        <span className="leading-tight">
          <span className="block text-tiny font-medium text-ink">{displayName}</span>
          <span className="block text-micro text-muted">{roleLabel}</span>
        </span>
      </div>
    </aside>
  );
}
