"use client";

import { Bell, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { NAV_GROUPS } from "./nav-items";

/**
 * Figma: component `Topbar` on page v5. Search, bell and avatar are constant;
 * only the breadcrumb changes per screen — here it is derived from the route,
 * so it can never drift out of sync with where you actually are.
 */
export function Topbar() {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();

  const entry = NAV_GROUPS.flatMap((g) => g.entries).find(
    (e) => pathname === e.href || pathname.startsWith(`${e.href}/`),
  );

  return (
    <header className="flex h-[58px] shrink-0 items-center gap-3 border-b border-line-subtle bg-surface pe-4 ps-7">
      <nav aria-label="Breadcrumb" className="text-tiny text-muted">
        <span>SUPSERV</span>
        {entry ? (
          <>
            <span className="px-2">/</span>
            <span className="text-secondary">{t(entry.messageKey)}</span>
          </>
        ) : null}
      </nav>

      <div className="ms-auto flex items-center gap-2">
        <label className="flex h-[34px] w-[300px] items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-2.5">
          <Search className="size-4 shrink-0 text-muted" aria-hidden />
          <input
            type="search"
            placeholder={tc("search")}
            className="w-full bg-transparent text-tiny text-ink outline-none placeholder:text-muted"
          />
        </label>
        <button
          type="button"
          aria-label="Notifications"
          className="relative flex size-[34px] items-center justify-center rounded-[var(--radius-control)] hover:bg-sunken"
        >
          <Bell className="size-4 text-secondary" aria-hidden />
          <span className="absolute end-2 top-2 size-2 rounded-full bg-critical" />
        </button>
        <span className="flex size-[34px] items-center justify-center rounded-full bg-chip text-tiny font-semibold text-secondary">
          AD
        </span>
      </div>
    </header>
  );
}
