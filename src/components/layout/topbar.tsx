"use client";

import { Bell, Check, LogOut, Search, User } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { setUiLocale, signOut } from "@/auth/actions";
import type { Role } from "@/auth/can";
import { Link, usePathname } from "@/i18n/navigation";
import { NAV_GROUPS } from "./nav-items";

/**
 * Figma: component `Topbar` on page v5. Search, bell and avatar are constant;
 * the breadcrumb is derived from the route so it cannot drift.
 *
 * The avatar menu is screen 80 — it was present in all 86 frames and dead in
 * every one of them. It is where the per-person language switch lives (LAW 4,
 * first axis), which is why screen 53 had a rule with no control behind it.
 */
export function Topbar({
  displayName,
  role,
  locale,
}: {
  displayName: string;
  role: Role;
  locale: string;
}) {
  const t = useTranslations();
  const tNav = useTranslations("nav");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const [open, setOpen] = useState(false);

  const entry = NAV_GROUPS.flatMap((g) => g.entries).find(
    (e) => pathname === e.href || pathname.startsWith(`${e.href}/`),
  );

  const initials = displayName
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="relative flex h-[58px] shrink-0 items-center gap-3 border-b border-line-subtle bg-surface pe-4 ps-4 md:ps-7">
      <nav aria-label="Breadcrumb" className="text-tiny text-muted">
        <span>SUPSERV</span>
        {entry ? (
          <>
            <span className="px-2">/</span>
            <span className="text-secondary">{tNav(entry.messageKey)}</span>
          </>
        ) : null}
      </nav>

      <div className="ms-auto flex items-center gap-2">
        {/* Screen 82 — this box was drawn on all 86 frames and did nothing. */}
        <form
          action={`/${locale}/search`}
          // Screen 86: on a phone the search box takes what is left rather than
          // 300px it does not have. It stays — reading is one of the four.
          className="flex h-[34px] w-[130px] items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 focus-within:border-ink sm:w-[220px] md:w-[300px]"
        >
          <Search className="size-4 shrink-0 text-muted" aria-hidden />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder={t("common.search")}
            className="w-full bg-transparent text-tiny text-ink outline-none placeholder:text-muted"
          />
        </form>

        <button
          type="button"
          aria-label={t("nav.notifications")}
          className="relative flex size-[34px] items-center justify-center rounded-[var(--radius-control)] hover:bg-sunken"
        >
          <Bell className="size-4 text-secondary" aria-hidden />
          <span className="absolute end-2 top-2 size-2 rounded-full bg-critical" />
        </button>

        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex size-[34px] items-center justify-center rounded-full bg-chip text-tiny font-semibold text-secondary hover:bg-line"
        >
          {initials}
        </button>
      </div>

      {open ? (
        <div
          role="menu"
          className="absolute end-4 top-full z-30 mt-1 w-[260px] rounded-[var(--radius-card)] border border-line bg-surface p-1.5 shadow-lg"
        >
          <div className="px-2.5 py-2">
            <p className="text-tiny font-medium text-ink">{displayName}</p>
            <p className="text-micro text-muted">{t(`auth.roles.${role}`)}</p>
          </div>

          <p className="px-2.5 pb-1 pt-2 text-micro font-medium text-muted">
            {t("profile.interfaceLanguage")}
          </p>
          {[
            { code: "fr", label: "Français" },
            { code: "en", label: "English" },
          ].map((option) => (
            <form
              key={option.code}
              action={setUiLocale.bind(null, option.code, pathname)}
              className="contents"
            >
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-1.5 text-tiny text-ink hover:bg-sunken"
              >
                <Check
                  className={`size-3.5 ${locale === option.code ? "text-ink" : "text-transparent"}`}
                  aria-hidden
                />
                {option.label}
              </button>
            </form>
          ))}

          <div className="my-1.5 h-px bg-line-subtle" />

          <Link
            href="/settings/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-1.5 text-tiny text-ink hover:bg-sunken"
          >
            <User className="size-3.5 text-secondary" aria-hidden />
            {t("profile.title")}
          </Link>

          <form action={signOut.bind(null, locale)} className="contents">
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-1.5 text-tiny text-ink hover:bg-sunken"
            >
              <LogOut className="size-3.5 text-secondary" aria-hidden />
              {t("common.signOut")}
            </button>
          </form>
        </div>
      ) : null}
    </header>
  );
}
